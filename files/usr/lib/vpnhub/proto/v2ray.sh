# vpnhub - V2Ray family share links (VLESS, VMess, Trojan, Shadowsocks, Hysteria2, TUIC) run by sing-box, device vhsb
V2UC=/usr/lib/vpnhub/v2link.uc
V2_RUN=$RUN/sing-box.json
V2_OK=$RUN/v2.ok

# really fetches something through the tunnel: the program being alive says nothing about the server
v2_check() {
	curl -s -m 6 -o /dev/null --interface vhsb http://1.1.1.1/ 2>/dev/null && return 0
	curl -s -m 6 -o /dev/null --interface vhsb --resolve dns.google:443:8.8.8.8 https://dns.google/ 2>/dev/null
}
v2_alive() { has_ip vhsb && pgrep -f "sing-box run -c $V2_RUN" >/dev/null 2>&1; }

# the status is asked every few seconds by the page: the real check is repeated at most once in 50 seconds
v2ray_up() {
	v2_alive || { rm -f $V2_OK; return 1; }
	if [ -f $V2_OK ] && [ $(( $(date +%s) - $(date -r $V2_OK +%s) )) -lt 50 ]; then [ "$(cat $V2_OK)" = 1 ]; return; fi
	if v2_check || v2_check; then echo 1 > $V2_OK; return 0; fi
	echo 0 > $V2_OK; return 1
}

# v2ray_parse <file>: "server port kind" of the link in the file;  v2ray_name <file>: the name written in the link
v2ray_parse() { ucode $V2UC info "$1" 2>/dev/null | awk -F'|' '$1 == "ok" { print $2, $3, $4; exit }'; }
v2ray_name() { ucode $V2UC info "$1" 2>/dev/null | awk -F'|' '$1 == "ok" { print $5; exit }'; }

v2ray_start() {
	[ -s "$BD/$1" ] || { echo "This server has no link."; return 1; }
	S=$(pget "$1" SERVER)
	IP=$(server_ip "$1")
	[ -n "$IP" ] || { echo "could not find the address of $S"; return 1; }
	v2ray_stop
	umask 077
	if ! ucode $V2UC conf "$BD/$1" "$IP" vhsb > $V2_RUN 2>/tmp/vpnhub-v2.err; then
		echo "This link is not supported: $(head -1 /tmp/vpnhub-v2.err)"; return 1
	fi
	if ! sing-box check -c $V2_RUN > /tmp/vpnhub-v2.err 2>&1; then
		echo "sing-box does not accept this link: $(tail -1 /tmp/vpnhub-v2.err | cut -c1-200)"; return 1
	fi
	/etc/init.d/vpnhub-sb start >/dev/null 2>&1
	end=$(( $(date +%s) + VH_WAIT * 2 ))
	while [ "$(date +%s)" -lt $end ]; do
		sleep 1
		if v2_alive && v2_check; then echo 1 > $V2_OK; return 0; fi
	done
	return 1
}

v2ray_stop() {
	/etc/init.d/vpnhub-sb stop >/dev/null 2>&1
	ip link del vhsb 2>/dev/null
	rm -f $V2_RUN $V2_OK
	return 0
}

v2ray_log() { cat /tmp/vpnhub-v2.err 2>/dev/null | tail -3; logread 2>/dev/null | grep 'sing-box' | tail -8 | sed 's/^.*daemon\.[a-z]* //'; }

# v2_add_links <file with one link per line> <subscription mark or empty>
# Makes a server for every readable link that is not in the list yet. Sets V2_ADDED / V2_BAD and leaves the ids
# of all readable links in /tmp/vpnhub-v2.ids. The internal name comes from the link itself, so the same link is never added twice.
v2_add_links() {
	ucode $V2UC info "$1" > /tmp/vpnhub-v2.info 2>/dev/null
	V2_ADDED=0; V2_BAD=0; : > /tmp/vpnhub-v2.ids; umask 077
	while IFS= read -r ln <&3 && IFS='|' read -r st h po pt nm <&4; do
		[ "$st" = skip ] && continue
		[ "$st" = ok ] || { V2_BAD=$((V2_BAD + 1)); continue; }
		ln=$(printf '%s' "$ln" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
		id=v$(printf '%s' "$ln" | md5sum | cut -c1-10)
		echo "$id" >> /tmp/vpnhub-v2.ids
		[ -f "$PD/$id" ] && continue
		ip=$(resolve "$h")
		nm=$(printf '%s' "$nm" | tr -d '|"\\' | cut -c1-60); [ -n "$nm" ] || nm=$h
		{
			printf 'TYPE=v2ray\nLABEL=%s\nSERVER=%s\nIP=%s\nUSER=\nPASS=\nPORT=%s\nPROTO=%s\n' "$nm" "$h" "$ip" "$po" "$pt"
			[ -n "$2" ] && echo "SUB=$2"
		} > "$PD/$id"
		printf '%s\n' "$ln" > "$BD/$id"
		chmod 600 "$PD/$id" "$BD/$id"
		V2_ADDED=$((V2_ADDED + 1))
	done 3< "$1" 4< /tmp/vpnhub-v2.info
	rm -f /tmp/vpnhub-v2.info
}

# sub_info <mark>: what the provider says about the account in the reply headers (used and total traffic, end date, name)
sub_info() {
	H=/tmp/vpnhub-sub.hdr; [ -f $H ] || return 0
	ui=$(tr -d '\r' < $H | grep -i '^subscription-userinfo:' | tail -1 | tr 'A-Z' 'a-z')
	g() { echo "$ui" | sed -n "s/.*[ ;:]$1=\([0-9]*\).*/\1/p"; }
	ti=$(tr -d '\r' < $H | grep -i '^profile-title:' | tail -1 | sed 's/^[^:]*: *//')
	case "$ti" in base64:*) ti=$(printf '%s' "${ti#base64:}" | b64dec 2>/dev/null) ;; esac
	ti=$(printf '%s' "$ti" | tr -d '|"\\\n' | cut -c1-60)
	if [ -n "$ui" ]; then echo "$(g upload)|$(g download)|$(g total)|$(g expire)|$ti" > "$D/subinfo.$1"; else rm -f "$D/subinfo.$1"; fi
	rm -f $H
}

# sub_info_all: only the account numbers of every subscription (quick; the server list is not touched)
sub_info_all() {
	[ -s $D/subs ] || return 0
	while IFS= read -r url; do
		[ -n "$url" ] || continue
		curl -fsSL -m 10 --max-filesize 3000000 -A "v2rayN/6.45" -D /tmp/vpnhub-sub.hdr -o /dev/null "$url" 2>/dev/null && sub_info "$(sub_mark "$url")"
	done < $D/subs
	rm -f /tmp/vpnhub-sub.hdr
}

sub_mark() { printf '%s' "$1" | md5sum | cut -c1-8; }

# sub_fetch <url> <output file>: the list behind a subscription address, as one link per line
sub_fetch() {
	UA="v2rayN/6.45"
	curl -fsSL -m 30 --max-filesize 3000000 -A "$UA" -D /tmp/vpnhub-sub.hdr -o /tmp/vpnhub-sub.raw "$1" 2>/dev/null || {
		# the address itself may be filtered on the direct line: try once through the running tunnel
		AT=$(active_type); [ -n "$AT" ] && has_ip "$(dev_of $AT)" || return 1
		curl -fsSL -m 30 --max-filesize 3000000 -A "$UA" --interface "$(dev_of $AT)" -D /tmp/vpnhub-sub.hdr -o /tmp/vpnhub-sub.raw "$1" 2>/dev/null || return 1
	}
	if grep -q '://' /tmp/vpnhub-sub.raw; then
		tr -d '\r' < /tmp/vpnhub-sub.raw
	else
		x=$(tr -d '\r\n ' < /tmp/vpnhub-sub.raw | tr '_-' '/+' | sed 's/=*$//')
		case $(( ${#x} % 4 )) in 2) x="$x==" ;; 3) x="$x=" ;; esac
		printf '%s' "$x" | b64dec 2>/dev/null | tr -d '\r'
	fi | grep '://' | head -600 > "$2"
	rm -f /tmp/vpnhub-sub.raw
	[ -s "$2" ]
}

# sub_run: reads every saved subscription again; adds the new servers and removes the ones that left the list
sub_run() {
	A=$(active); add=0; del=0; fail=0; marks=""
	[ -s $D/subs ] && while IFS= read -r url <&5; do
		[ -n "$url" ] || continue
		mk=$(sub_mark "$url"); marks="$marks $mk"
		if sub_fetch "$url" /tmp/vpnhub-sub.links; then
			sub_info "$mk"
			v2_add_links /tmp/vpnhub-sub.links "$mk"
			add=$((add + V2_ADDED))
			for f in $(grep -l "^SUB=$mk\$" $PD/v* 2>/dev/null); do
				id=${f##*/}
				grep -qx "$id" /tmp/vpnhub-v2.ids && continue
				[ "$id" = "$A" ] && continue
				rm -f "$PD/$id" "$BD/$id"; del=$((del + 1))
			done
		else
			fail=$((fail + 1))
		fi
	done 5< $D/subs
	# servers of a subscription that was taken out of the list
	for f in $(grep -l '^SUB=' $PD/v* 2>/dev/null); do
		id=${f##*/}; mk=$(pget "$id" SUB)
		case " $marks " in *" $mk "*) continue ;; esac
		[ "$id" = "$A" ] && continue
		rm -f "$PD/$id" "$BD/$id"; del=$((del + 1))
	done
	for f in $D/subinfo.*; do [ -f "$f" ] || continue; case " $marks " in *" ${f##*.} "*) ;; *) rm -f "$f" ;; esac; done
	rm -f /tmp/vpnhub-sub.links /tmp/vpnhub-v2.ids /tmp/vpnhub-sub.hdr
	date +%s > $D/sub.last
	echo "done added=$add removed=$del failed=$fail"
}
