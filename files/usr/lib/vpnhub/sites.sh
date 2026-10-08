# vpnhub - "this site through that server": a few extra V2Ray tunnels that run next to the main tunnel
# (sourced by /usr/bin/vpnhub). Each rule gets its own sing-box, device vhx<n>, routing table 10<n> and mark.
# A rule wins over everything else (Iran-direct, the direct list, the main tunnel) and also works while the main tunnel is off.
SITES=$D/sites
SX_MAX=5
SX_MARK=0x65000
SX_NFT=/tmp/vpnhub-sites.nft

sx_running() {
	pgrep -f "sing-box run -c $RUN/sx$1.json" >/dev/null 2>&1 || return 1
	[ ! -f $RUN/xsx$1.json ] || pgrep -f "xray run -c $RUN/xsx$1.json" >/dev/null 2>&1
}
sx_alive() { has_ip vhx$1 && sx_running $1; }
sx_check() { curl -s -m 6 -o /dev/null --interface vhx$1 http://1.1.1.1/ 2>/dev/null || curl -s -m 6 -o /dev/null --interface vhx$1 --resolve dns.google:443:8.8.8.8 https://dns.google/ 2>/dev/null; }
# sx_rules: the saved rules as "<n> <server id> <entries>" (only rules whose server still exists)
sx_rules() {
	[ -s $SITES ] || return 0
	n=0
	while read -r id ents; do
		[ -n "$id" ] && [ -n "$ents" ] || continue
		n=$((n + 1)); [ $n -le $SX_MAX ] || break
		[ "$(pget "$id" TYPE)" = v2ray ] && [ -s "$BD/$id" ] && echo "$n $id $ents"
	done < $SITES
}
# sx_fill: asks the router's own name service for every rule site, so the addresses are in the routing sets even when
# a phone or browser still remembers the address from before and never asks again
sx_fill() {
	[ -f $RUN/sx.doms ] || return 0
	head -60 $RUN/sx.doms | while read -r d; do
		nslookup -timeout=3 "$d" 127.0.0.1 >/dev/null 2>&1
		nslookup -timeout=3 "www.$d" 127.0.0.1 >/dev/null 2>&1
	done
}
sx_alive_list() { o=""; for k in 1 2 3 4 5; do sx_alive $k && o="$o$k"; done; echo "$o"; }

sites_route_clear() {
	for k in 1 2 3 4 5; do
		while ip rule del prio 99$k 2>/dev/null; do :; done
		ip route flush table 10$k 2>/dev/null
	done
	nft delete table inet vpnhub_sites 2>/dev/null
}

# sites_route: marks and name rules for the rules whose tunnel is really there
sites_route() {
	if [ "$ALL_DEVICES" = 1 ]; then C=$(lan_net); else C=$(r_ips $D/clients | r_csv); fi
	DNSDIR=$(dns_dir); DC="$DNSDIR/vpnhub-sites.conf"
	NFTSET=0; dnsmasq -v 2>/dev/null | grep -q ' nftset' && NFTSET=1
	: > $RUN/sx.doms; : > /tmp/vpnhub-sites.dns; : > /tmp/vpnhub-sites.r1; : > /tmp/vpnhub-sites.r2; LIVE=""
	sx_rules > /tmp/vpnhub-sites.list
	while read -r k id ents; do
		sx_alive $k || continue
		LIVE="$LIVE $k"
		echo "$ents" | tr ',' '\n' > /tmp/vpnhub-sites.e
		echo "	set s$k { type ipv4_addr; flags interval; auto-merge; $(r_elems "$(r_ips /tmp/vpnhub-sites.e | r_csv)") }" >> /tmp/vpnhub-sites.r1
		echo "	set d$k { type ipv4_addr; size 65535; }" >> /tmp/vpnhub-sites.r1
		echo "		ip daddr @s$k meta mark set $SX_MARK$k return" >> /tmp/vpnhub-sites.r2
		echo "		ip daddr @d$k meta mark set $SX_MARK$k return" >> /tmp/vpnhub-sites.r2
		for d in $(r_doms /tmp/vpnhub-sites.e); do
			# the name is asked through the rule's own tunnel, so the answer fits the place the traffic leaves from
			echo "$d" >> $RUN/sx.doms
			echo "server=/$d/1.1.1.1@vhx$k" >> /tmp/vpnhub-sites.dns
			[ $NFTSET = 1 ] && echo "nftset=/$d/4#inet#vpnhub_sites#d$k" >> /tmp/vpnhub-sites.dns
		done
	done < /tmp/vpnhub-sites.list
	sites_route_clear
	if [ -n "$LIVE" ] && [ -n "$C" ]; then
		{
			echo "table inet vpnhub_sites {"
			echo "	set clients { type ipv4_addr; flags interval; auto-merge; elements = { $C } }"
			cat /tmp/vpnhub-sites.r1
			echo "	chain pre { type filter hook prerouting priority mangle - 5; policy accept;"
			echo "		meta nfproto != ipv4 return"
			echo "		ip saddr != @clients return"
			cat /tmp/vpnhub-sites.r2
			echo "	}"
			echo "}"
		} > $SX_NFT
		if nft -f $SX_NFT 2>/tmp/vpnhub-sites.err; then
			for k in $LIVE; do
				ip route replace default dev vhx$k table 10$k
				ip rule add fwmark $SX_MARK$k lookup 10$k prio 99$k
			done
		else
			say "site rules rejected: $(head -2 /tmp/vpnhub-sites.err)"; : > /tmp/vpnhub-sites.dns
		fi
	else
		: > /tmp/vpnhub-sites.dns
	fi
	echo "$LIVE" | tr -d ' ' > $RUN/sx.state
	if [ -n "$DNSDIR" ]; then
		if [ -s /tmp/vpnhub-sites.dns ]; then
			# the sets were just rebuilt empty: dnsmasq must forget what it remembers
			cp /tmp/vpnhub-sites.dns "$DC"; /etc/init.d/dnsmasq restart >/dev/null 2>&1
			sleep 2; sx_fill
		elif [ -f "$DC" ]; then
			rm -f "$DC"; /etc/init.d/dnsmasq restart >/dev/null 2>&1
		fi
	fi
	rm -f /tmp/vpnhub-sites.dns /tmp/vpnhub-sites.r1 /tmp/vpnhub-sites.r2 /tmp/vpnhub-sites.e /tmp/vpnhub-sites.list $SX_NFT
}

sites_down() {
	/etc/init.d/vpnhub-sx stop >/dev/null 2>&1
	/etc/init.d/vpnhub-xx stop >/dev/null 2>&1
	for k in 1 2 3 4 5; do ip link del vhx$k 2>/dev/null; rm -f $RUN/sx$k.json $RUN/xsx$k.json; done
	sites_route
}

# sites_up: (re)starts the tunnels of all rules, then routes through the ones that came up. Prints one line per rule.
sites_up() {
	/etc/init.d/vpnhub-sx stop >/dev/null 2>&1
	/etc/init.d/vpnhub-xx stop >/dev/null 2>&1
	for k in 1 2 3 4 5; do ip link del vhx$k 2>/dev/null; rm -f $RUN/sx$k.json $RUN/xsx$k.json; done
	command -v sing-box >/dev/null 2>&1 || { sites_route; echo "sing-box is not installed"; return 1; }
	date +%s > /tmp/vpnhub-sites.last
	umask 077; WANT=""
	sx_rules > /tmp/vpnhub-sites.up
	while read -r k id ents; do
		IP=$(server_ip "$id")
		[ -n "$IP" ] || { echo "rule $k: could not find the address of $(pget "$id" SERVER)"; continue; }
		XP=""; v2_needx "$BD/$id" && XP=$((10810 + k))
		if ucode $V2UC conf "$BD/$id" "$IP" vhx$k "172.19.$k.1/30" $XP > $RUN/sx$k.json 2>/dev/null && sing-box check -c $RUN/sx$k.json >/dev/null 2>&1 \
			&& { [ -z "$XP" ] || { ucode $V2UC xconf "$BD/$id" "$IP" $XP > $RUN/xsx$k.json 2>/dev/null && xray run -test -c $RUN/xsx$k.json >/dev/null 2>&1; }; }; then
			WANT="$WANT $k"
		else
			rm -f $RUN/sx$k.json $RUN/xsx$k.json; echo "rule $k: this link is not supported"
		fi
	done < /tmp/vpnhub-sites.up
	rm -f /tmp/vpnhub-sites.up
	if [ -n "$WANT" ]; then
		ls $RUN/xsx[1-5].json >/dev/null 2>&1 && { /etc/init.d/vpnhub-xx start >/dev/null 2>&1; sleep 1; }
		/etc/init.d/vpnhub-sx start >/dev/null 2>&1
		end=$(( $(date +%s) + 20 ))
		while [ "$(date +%s)" -lt $end ]; do
			sleep 1; ok=1
			for k in $WANT; do sx_alive $k || ok=0; done
			[ $ok = 1 ] && break
		done
		for k in $WANT; do
			if sx_alive $k && { sx_check $k || sx_check $k; }; then echo "rule $k: connected"; else echo "rule $k: the server does not answer"; fi
		done
	fi
	sites_route
}

# sites_watch (every minute): bring back tunnels that are gone, and keep the routing in step with what is alive
sites_watch() {
	[ -s $SITES ] || { [ -s $RUN/sx.state ] && sites_down; return 0; }
	[ -f /tmp/vpnhub-sitesrun ] && return 0
	missing=0
	for k in $(sx_rules | cut -d' ' -f1); do sx_running $k || missing=1; done
	if [ $missing = 1 ] && [ $(( $(date +%s) - $(cat /tmp/vpnhub-sites.last 2>/dev/null || echo 0) )) -ge 180 ]; then
		sites_up >/dev/null 2>&1; return 0
	fi
	if [ "$(sx_alive_list)" = "$(cat $RUN/sx.state 2>/dev/null)" ]; then sx_fill; else sites_route; fi
}
