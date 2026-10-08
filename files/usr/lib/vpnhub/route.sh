# vpnhub - routing and DNS for the active tunnel (sourced by /usr/bin/vpnhub)
# route_up: LAN devices -> tunnel (with the direct / tunnel exceptions); route_down: everything back to the direct line
MARK=0x640000
RT_TABLE=100
IRAN_DIRECT=1
ALL_DEVICES=1
[ -f $D/settings ] && . $D/settings

iran_file() { if [ -s $D/iran-ipv4.txt ]; then echo $D/iran-ipv4.txt; else echo /usr/share/vpnhub/iran-ipv4.txt; fi; }
iran_dom_file() { if [ -s $D/iran-domains.txt ]; then echo $D/iran-domains.txt; else echo /usr/share/vpnhub/iran-domains.txt; fi; }
# name servers asked through the tunnel (settings page); the default is two public ones
tun_dns() { d=$(cat $D/dns 2>/dev/null); echo ${d:-1.1.1.1 8.8.8.8}; }
dns_dir() { ls -d /tmp/dnsmasq.cfg*.d /tmp/dnsmasq.d 2>/dev/null | head -1; }
r_lines() { [ -f "$1" ] && grep -v '^#' "$1" | tr -d '\r' | grep -E '^[A-Za-z0-9./:_-]+$'; }
r_ips() { r_lines "$1" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(/[0-9]+)?$'; }
r_doms() { r_lines "$1" | grep -vE '^[0-9./]+$' | grep -E '^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$'; }
r_csv() { tr '\n' ',' | sed 's/,$//'; }
r_elems() { [ -n "$1" ] && echo "elements = { $1 }"; }
has_rules() { ip rule 2>/dev/null | grep -q "lookup $RT_TABLE"; }

route_clear() {
	while ip rule del prio 1000 2>/dev/null; do :; done
	nft delete table inet vpnhub 2>/dev/null
}
route_dns_off() {
	c="$(dns_dir)/vpnhub.conf"
	[ -f "$c" ] && { rm -f "$c"; /etc/init.d/dnsmasq restart >/dev/null 2>&1; }
}
route_down_now() { route_clear; route_dns_off; return 0; }

# the tunnel programs and vpnhub itself may ask for the same change at the same moment: one at a time
route_lock() { n=0; while ! mkdir /tmp/vpnhub-route.lock 2>/dev/null; do n=$((n + 1)); [ $n -ge 25 ] && break; sleep 1; done; }
route_unlock() { rmdir /tmp/vpnhub-route.lock 2>/dev/null; }
route_down() { route_lock; route_down_now; route_unlock; return 0; }
route_up() { route_lock; route_up_now; r=$?; route_unlock; return $r; }

route_up_now() {
	DEV=$(dev_of "$(active_type)")
	[ -n "$DEV" ] && ip link show "$DEV" >/dev/null 2>&1 || { route_down_now; return 0; }
	if [ "$ALL_DEVICES" = 1 ]; then C=$(lan_net); else C=$(r_ips $D/clients | r_csv); fi
	[ -n "$C" ] || { route_down_now; return 0; }
	IRF=$(iran_file)
	if [ "$IRAN_DIRECT" = 1 ] && [ ! -s "$IRF" ]; then say "Iran address list is missing, not routing"; route_down_now; return 1; fi
	{
		echo "table inet vpnhub {"
		echo "	set iran { type ipv4_addr; flags interval; auto-merge;"
		[ "$IRAN_DIRECT" = 1 ] && { echo "elements = {"; grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(/[0-9]+)?$' "$IRF" | sed 's/$/,/'; echo "}"; }
		echo "	}"
		echo "	set clients { type ipv4_addr; flags interval; auto-merge; elements = { $C } }"
		echo "	set direct4 { type ipv4_addr; flags interval; auto-merge; $(r_elems "$(r_ips $D/direct | r_csv)") }"
		echo "	set tunnel4 { type ipv4_addr; flags interval; auto-merge; $(r_elems "$(r_ips $D/tunnel | r_csv)") }"
		echo "	set direct_dyn { type ipv4_addr; size 65535; }"
		echo "	set tunnel_dyn { type ipv4_addr; size 65535; }"
		echo "	chain pre { type filter hook prerouting priority mangle; policy accept;"
		echo "		meta nfproto != ipv4 return"
		echo "		ip saddr != @clients return"
		echo "		ip daddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16, 224.0.0.0/3 } return"
		echo "		ip daddr @tunnel4 meta mark set $MARK return"
		echo "		ip daddr @tunnel_dyn meta mark set $MARK return"
		echo "		ip daddr @direct4 return"
		echo "		ip daddr @direct_dyn return"
		echo "		ip daddr @iran return"
		echo "		meta mark set $MARK"
		echo "	}"
		echo "}"
	} > /tmp/vpnhub.nft
	if ! nft -c -f /tmp/vpnhub.nft 2>/tmp/vpnhub.nft.err; then say "routing rules rejected: $(head -2 /tmp/vpnhub.nft.err)"; return 1; fi
	route_clear
	nft -f /tmp/vpnhub.nft || { say "routing rules could not be loaded"; route_dns_off; return 1; }
	ip route replace default dev "$DEV" table $RT_TABLE
	ip rule add fwmark $MARK lookup $RT_TABLE prio 1000
	DNSDIR=$(dns_dir)
	if [ -n "$DNSDIR" ]; then
		WDNS=$(sed -n 's/^nameserver \([0-9.]*\)$/\1/p' /tmp/resolv.conf.d/resolv.conf.auto /tmp/resolv.conf.auto 2>/dev/null | head -1)
		NFTSET=0; dnsmasq -v 2>/dev/null | grep -q ' nftset' && NFTSET=1
		DD=$(r_doms $D/direct); TD=$(r_doms $D/tunnel)
		{
			echo "no-resolv"
			for ns in $(tun_dns); do echo "server=$ns@$DEV"; done
			if [ "$IRAN_DIRECT" = 1 ]; then
				# Iranian sites: names answered by the line's own DNS, and their addresses always direct
				# (this also covers Iranian sites that are hosted outside Iran)
				[ -n "$WDNS" ] && echo "server=/ir/$WDNS"
				[ $NFTSET = 1 ] && echo "nftset=/ir/4#inet#vpnhub#direct_dyn"
				IDF=$(iran_dom_file)
				[ -s "$IDF" ] && grep -E '^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$' "$IDF" | awk -v W="$WDNS" -v N=$NFTSET '
					{ l = l "/" $0; n++ }
					n == 10 { out() }
					function out() { if (n == 0) return; if (W != "") print "server=" l "/" W; if (N == 1) print "nftset=" l "/4#inet#vpnhub#direct_dyn"; l = ""; n = 0 }
					END { out() }'
			fi
			for d in $DD; do [ -n "$WDNS" ] && echo "server=/$d/$WDNS"; [ $NFTSET = 1 ] && echo "nftset=/$d/4#inet#vpnhub#direct_dyn"; done
			for d in $TD; do [ $NFTSET = 1 ] && echo "nftset=/$d/4#inet#vpnhub#tunnel_dyn"; done
		} > "$DNSDIR/vpnhub.conf.new"
		# the sets were just rebuilt empty, so dnsmasq must forget its cache whenever domain rules exist
		if ! cmp -s "$DNSDIR/vpnhub.conf.new" "$DNSDIR/vpnhub.conf" 2>/dev/null || grep -q '^nftset=' "$DNSDIR/vpnhub.conf.new"; then
			mv "$DNSDIR/vpnhub.conf.new" "$DNSDIR/vpnhub.conf"; /etc/init.d/dnsmasq restart >/dev/null 2>&1
		else
			rm -f "$DNSDIR/vpnhub.conf.new"
		fi
	fi
	return 0
}

# ---------------------------------------------------------------- updating the Iran lists
UA_FETCH() { curl -fsSL -m 25 -o "$2" "$1" 2>/dev/null; }

# ip_list_ok <file>: enough ranges, covers well known Iranian addresses, covers no well known foreign one
ip_list_ok() {
	awk -F'[./]' '
		function n(a, b, c, d) { return ((a * 256 + b) * 256 + c) * 256 + d }
		function has(x) { return x >= lo && x <= hi }
		BEGIN { f1 = n(1,1,1,1); f2 = n(8,8,8,8); f3 = n(142,250,0,1); f4 = n(104,16,0,1); i1 = n(2,144,0,1); i2 = n(78,38,0,1); i3 = n(5,200,200,1) }
		/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\/[0-9]+$/ {
			c++; if ($5 < 8 || $5 > 32) bad = 1
			lo = n($1, $2, $3, $4); hi = lo + 2 ^ (32 - $5) - 1
			if (has(f1) || has(f2) || has(f3) || has(f4)) bad = 1
			if (has(i1)) g1 = 1; if (has(i2)) g2 = 1; if (has(i3)) g3 = 1
		}
		END { exit !(c >= 500 && !bad && g1 && g2 && g3) }' "$1"
}

# dom_walk <list name>: prints the domains of a v2fly domain-list-community file, following its includes
dom_walk() {
	grep -qx "$1" /tmp/vpnhub-dom.seen 2>/dev/null && return 0
	echo "$1" >> /tmp/vpnhub-dom.seen
	df=/tmp/vpnhub-dom.$1
	UA_FETCH "https://raw.githubusercontent.com/v2fly/domain-list-community/master/data/$1" "$df" \
		|| UA_FETCH "https://cdn.jsdelivr.net/gh/v2fly/domain-list-community@master/data/$1" "$df" \
		|| { echo "$1" >> /tmp/vpnhub-dom.failed; return 1; }
	sed 's/#.*//' "$df" | tr -d '\r' | while read -r a rest; do
		case "$a" in
			"") ;;
			include:*) dom_walk "${a#include:}" ;;
			regexp:*|keyword:*) ;;
			full:*|domain:*) echo "${a#*:}" ;;
			*) echo "$a" ;;
		esac
	done
	rm -f "$df"
}

# iran_update: refresh both Iran lists. Prints "updated ips=<n|-> domains=<n|->" ("-" = that part kept its old list)
iran_update() {
	T=/tmp/vpnhub-iran.new; NI=-; ND=-
	# 1) address ranges, from the regional internet registry data
	for u in "https://raw.githubusercontent.com/ipverse/rir-ip/master/country/ir/ipv4-aggregated.txt" \
		"https://cdn.jsdelivr.net/gh/ipverse/rir-ip@master/country/ir/ipv4-aggregated.txt" \
		"https://raw.githubusercontent.com/herrbischoff/country-ip-blocks/master/ipv4/ir.cidr" \
		"https://cdn.jsdelivr.net/gh/herrbischoff/country-ip-blocks@master/ipv4/ir.cidr" \
		"https://www.ipdeny.com/ipblocks/data/aggregated/ir-aggregated.zone"; do
		rm -f $T
		UA_FETCH "$u" $T.raw && grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/[0-9]+$' $T.raw > $T
		if ip_list_ok $T 2>/dev/null; then break; fi
		rm -f $T
	done
	if [ ! -s $T ] && command -v geoview >/dev/null 2>&1 && [ -s /usr/share/v2ray/geoip.dat ]; then
		geoview -type geoip -input /usr/share/v2ray/geoip.dat -list ir -ipv6=false -output $T >/dev/null 2>&1
		ip_list_ok $T 2>/dev/null || rm -f $T
	fi
	if [ -s $T ]; then mv $T $D/iran-ipv4.txt; NI=$(grep -c . $D/iran-ipv4.txt); fi
	rm -f $T $T.raw
	# 2) Iranian sites whose names do not end in .ir (v2fly "category-ir" plus the extra list shipped with vpnhub)
	rm -f /tmp/vpnhub-dom.*
	dom_walk category-ir > /tmp/vpnhub-dom.out
	if [ ! -s /tmp/vpnhub-dom.failed ] && [ "$(grep -c . /tmp/vpnhub-dom.out)" -ge 100 ] && grep -qx 'varzesh3.com' /tmp/vpnhub-dom.out; then
		cat /tmp/vpnhub-dom.out /usr/share/vpnhub/iran-domains-extra.txt 2>/dev/null | tr 'A-Z' 'a-z' \
			| grep -E '^[a-z0-9_-]+(\.[a-z0-9_-]+)+$' | grep -vE '\.ir$' | sort -u > $D/iran-domains.txt
		ND=$(grep -c . $D/iran-domains.txt)
	fi
	rm -f /tmp/vpnhub-dom.*
	echo "updated ips=$NI domains=$ND"
	has_rules && route_up
	[ "$NI" != - ] || [ "$ND" != - ]
}
