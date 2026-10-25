package expo.modules.networktools

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.os.SystemClock
import android.util.Base64
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.net.ConnectException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NoRouteToHostException
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import javax.net.SocketFactory

/**
 * Android-only network helpers for the printer scanner. Everything here works without root:
 *  - IPv4 / prefix / gateway / DHCP server of the Wi-Fi link (LinkProperties, DhcpInfo)
 *  - WifiManager.MulticastLock while mDNS runs
 *  - UDP request/response (SNMP) on a socket bound to the Wi-Fi network
 *  - TCP connect probes (open / refused / timeout / unreachable) for subnet sweeps and IP conflict checks
 *  - /proc/net/arp, which is only readable up to Android 9 (API 28)
 *
 * It cannot send raw Ethernet/ARP frames, read the ARP cache on Android 10+, or change the phone's IP.
 */
class NetworkToolsModule : Module() {
  private var multicastLock: WifiManager.MulticastLock? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("NetworkTools")

    Function("getLinkInfo") {
      readLinkInfo()
    }

    Function("acquireMulticastLock") {
      val lock = multicastLock ?: wifiManager().createMulticastLock("printer-scanner").also {
        it.setReferenceCounted(false)
        multicastLock = it
      }
      if (!lock.isHeld) lock.acquire()
      lock.isHeld
    }

    Function("releaseMulticastLock") {
      multicastLock?.takeIf { it.isHeld }?.release()
      true
    }

    // Blocking socket work runs on Dispatchers.IO: the default Expo async queue is a single thread.
    AsyncFunction("udpExchange") Coroutine { targets: List<String>, port: Int, payloadsBase64: List<String>, timeoutMs: Int, rounds: Int ->
      withContext(Dispatchers.IO) {
        udpExchange(targets, port, payloadsBase64.map { Base64.decode(it, Base64.NO_WRAP) }, timeoutMs, rounds)
      }
    }

    AsyncFunction("probeHosts") Coroutine { hosts: List<String>, ports: List<Int>, timeoutMs: Int, concurrency: Int ->
      withContext(Dispatchers.IO) {
        probeHosts(hosts, ports, timeoutMs, concurrency)
      }
    }

    AsyncFunction("readArpTable") Coroutine { ->
      withContext(Dispatchers.IO) {
        readArpTable()
      }
    }

    OnDestroy {
      multicastLock?.takeIf { it.isHeld }?.release()
      multicastLock = null
    }
  }

  private fun wifiManager(): WifiManager =
    context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

  private fun connectivity(): ConnectivityManager =
    context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

  /** Prefer the Wi-Fi network even when mobile data is the default route. */
  private fun findWifiNetwork(cm: ConnectivityManager): Network? {
    val active = cm.activeNetwork
    val activeIsWifi = active != null &&
      cm.getNetworkCapabilities(active)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
    if (activeIsWifi) return active
    @Suppress("DEPRECATION")
    return cm.allNetworks.firstOrNull {
      cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
    }
  }

  private fun readLinkInfo(): Map<String, Any?> {
    val cm = connectivity()
    val wifiEnabled = try {
      wifiManager().isWifiEnabled
    } catch (e: SecurityException) {
      null
    }
    val network = findWifiNetwork(cm)
    val lp = network?.let { cm.getLinkProperties(it) }
    val v4 = lp?.linkAddresses?.firstOrNull { it.address is Inet4Address }
    val gateway = lp?.routes
      ?.firstOrNull { it.isDefaultRoute && it.gateway is Inet4Address }
      ?.gateway?.hostAddress
      ?.takeIf { it != "0.0.0.0" }

    @Suppress("DEPRECATION")
    val dhcpServer = try {
      wifiManager().dhcpInfo?.serverAddress?.takeIf { it != 0 }?.let { littleEndianToIp(it) }
    } catch (e: SecurityException) {
      null
    }

    return mapOf(
      "sdkInt" to Build.VERSION.SDK_INT,
      "wifiEnabled" to wifiEnabled,
      "hasWifiNetwork" to (network != null),
      "ipAddress" to v4?.address?.hostAddress,
      "prefixLength" to v4?.prefixLength,
      "gateway" to gateway,
      "dhcpServer" to dhcpServer,
      "interfaceName" to lp?.interfaceName,
      "dnsServers" to (lp?.dnsServers?.filterIsInstance<Inet4Address>()?.mapNotNull { it.hostAddress } ?: emptyList<String>())
    )
  }

  private fun littleEndianToIp(value: Int): String =
    listOf(value and 0xff, (value shr 8) and 0xff, (value shr 16) and 0xff, (value ushr 24) and 0xff).joinToString(".")

  private fun udpExchange(
    targets: List<String>,
    port: Int,
    payloads: List<ByteArray>,
    timeoutMs: Int,
    rounds: Int
  ): List<Map<String, Any?>> {
    val replies = mutableListOf<Map<String, Any?>>()
    DatagramSocket().use { socket ->
      socket.broadcast = true
      findWifiNetwork(connectivity())?.let { network ->
        try {
          network.bindSocket(socket)
        } catch (ignored: IOException) {
        }
      }

      val addresses = targets.map { InetAddress.getByName(it) }
      repeat(rounds.coerceAtLeast(1)) { round ->
        if (round > 0) Thread.sleep(300)
        for (address in addresses) {
          for (payload in payloads) {
            try {
              socket.send(DatagramPacket(payload, payload.size, address, port))
            } catch (ignored: IOException) {
              // e.g. ENETUNREACH for an off-subnet unicast target; the receive loop just times out
            }
          }
        }
      }

      val buffer = ByteArray(65535)
      val deadline = SystemClock.elapsedRealtime() + timeoutMs
      while (true) {
        val remaining = deadline - SystemClock.elapsedRealtime()
        if (remaining <= 0) break
        socket.soTimeout = remaining.toInt().coerceAtLeast(1)
        val packet = DatagramPacket(buffer, buffer.size)
        try {
          socket.receive(packet)
        } catch (ignored: SocketTimeoutException) {
          break
        }
        replies += mapOf(
          "address" to packet.address.hostAddress,
          "port" to packet.port,
          "data" to Base64.encodeToString(packet.data, packet.offset, packet.length, Base64.NO_WRAP)
        )
      }
    }
    return replies
  }

  /**
   * TCP connect to every host:port pair. "refused" (RST) proves a host owns the IP just as well as "open";
   * "unreachable" after a long enough timeout usually means the kernel got no ARP answer.
   */
  private fun probeHosts(hosts: List<String>, ports: List<Int>, timeoutMs: Int, concurrency: Int): List<Map<String, Any?>> {
    val factory: SocketFactory? = findWifiNetwork(connectivity())?.socketFactory
    val pool = Executors.newFixedThreadPool(concurrency.coerceIn(1, 128))
    try {
      val tasks = hosts.flatMap { host ->
        ports.map { port -> Callable { Triple(host, port, probePort(factory, host, port, timeoutMs)) } }
      }
      val results = pool.invokeAll(tasks).map { it.get() }
      return results.groupBy { it.first }.map { (host, entries) ->
        mapOf(
          "host" to host,
          "ports" to entries.associate { it.second.toString() to it.third }
        )
      }
    } finally {
      pool.shutdownNow()
    }
  }

  private fun probePort(factory: SocketFactory?, host: String, port: Int, timeoutMs: Int): String {
    val socket = try {
      factory?.createSocket() ?: Socket()
    } catch (e: IOException) {
      return "error"
    }
    return try {
      socket.connect(InetSocketAddress(InetAddress.getByName(host), port), timeoutMs)
      "open"
    } catch (e: SocketTimeoutException) {
      "timeout"
    } catch (e: NoRouteToHostException) {
      "unreachable"
    } catch (e: ConnectException) {
      val msg = e.message.orEmpty()
      when {
        msg.contains("ECONNREFUSED") -> "refused"
        msg.contains("EHOSTUNREACH") || msg.contains("ENETUNREACH") -> "unreachable"
        msg.contains("ETIMEDOUT") -> "timeout"
        else -> "error"
      }
    } catch (e: IOException) {
      "error"
    } finally {
      try {
        socket.close()
      } catch (ignored: IOException) {
      }
    }
  }

  private fun readArpTable(): Map<String, Any?> {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      return mapOf("available" to false, "reason" to "Android 10+ không cho ứng dụng đọc bảng ARP", "entries" to emptyList<Any>())
    }
    return try {
      val entries = File("/proc/net/arp").readLines().drop(1).mapNotNull { line ->
        val cols = line.trim().split(Regex("\\s+"))
        if (cols.size < 6) return@mapNotNull null
        mapOf("ip" to cols[0], "flags" to cols[2], "mac" to cols[3].uppercase(), "device" to cols[5])
      }
      mapOf("available" to true, "reason" to null, "entries" to entries)
    } catch (e: Exception) {
      mapOf("available" to false, "reason" to (e.message ?: "Không đọc được /proc/net/arp"), "entries" to emptyList<Any>())
    }
  }
}
