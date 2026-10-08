# vpnhub - SSTP (sstp-client through netifd), network interface vhsstp (device sstp-vhsstp)
sstp_up() { ifstatus vhsstp 2>/dev/null | grep -q '"up": true'; }

sstp_start() {
	S=$(pget "$1" SERVER)
	[ -n "$S" ] || { echo "This profile has no server."; return 1; }
	cred_of "$1" || { echo "No username/password saved yet."; return 1; }
	IP=$(server_ip "$1")
	[ -n "$IP" ] || { echo "could not find the address of $S"; return 1; }
	uci -q get network.vhsstp >/dev/null || { echo "The SSTP interface is missing; run the installer again."; return 1; }
	ifdown vhsstp 2>/dev/null
	PO=$(pget "$1" PORT)
	uci set network.vhsstp.server="$IP"
	uci set network.vhsstp.port="${PO:-443}"
	uci set network.vhsstp.username="$CU"
	uci set network.vhsstp.password="$CP"
	uci commit network
	ubus call network reload >/dev/null 2>&1
	sleep 1
	ifup vhsstp
	wait_up sstp_up
}

sstp_stop() { ifdown vhsstp 2>/dev/null; return 0; }

sstp_log() { logread | grep -E "sstpc|pppd" | tail -8 | sed 's/^.*daemon\.[a-z]* //'; }
