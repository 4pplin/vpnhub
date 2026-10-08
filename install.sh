#!/bin/sh
# vpnhub installer for OpenWrt (22.03 or newer, with LuCI and the nftables firewall).
#   wget -O /tmp/vpnhub-install.sh https://raw.githubusercontent.com/4pplin/vpnhub/main/install.sh && sh /tmp/vpnhub-install.sh
# Options:  --no-packages   do not install or change any system package
#           --keep-dnsmasq  do not replace dnsmasq with dnsmasq-full (domain rules then work only partly)
#           --no-singbox    do not install sing-box (the V2Ray page; it needs about 40 MB of storage)
#           --no-stats      do not install the usage monitor (data used by each device) and the history graphs
#           --no-amneziawg  do not download the AmneziaWG kernel module (it is not in the official OpenWrt feeds)
#           --no-theme      keep the router's own panel look (by default the panel gets the Hub look: side menu, EN / FA
#                           switch, Vazirmatn font, Persian language pack; the old look stays one click away in the menu)
#           --image         first boot of a firmware image that already contains the files and packages: only set things up
REPO=4pplin/vpnhub
BRANCH=main
BASES="https://raw.githubusercontent.com/$REPO/$BRANCH https://cdn.jsdelivr.net/gh/$REPO@$BRANCH"
MIRROR=mirrors.tuna.tsinghua.edu.cn/openwrt
# Vazirmatn (SIL Open Font License) is fetched from its own project, it is not part of this repository
FLAG_URLS="https://cdn.jsdelivr.net/npm/country-flag-emoji-polyfill@0.1.8/dist/TwemojiCountryFlags.woff2 https://unpkg.com/country-flag-emoji-polyfill@0.1.8/dist/TwemojiCountryFlags.woff2"
FONT_URLS="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn%5Bwght%5D.woff2 https://github.com/rastikerdar/vazirmatn/raw/v33.003/fonts/webfonts/Vazirmatn%5Bwght%5D.woff2"
NOPKG=0; KEEPDNS=0; NOAWG=0; NOSB=0; NOSTATS=0; THEME=1; IMG=0
for a in "$@"; do case "$a" in --no-packages) NOPKG=1 ;; --keep-dnsmasq) KEEPDNS=1 ;; --no-amneziawg) NOAWG=1 ;; --no-singbox) NOSB=1 ;; --no-stats) NOSTATS=1 ;; --theme) THEME=1 ;; --no-theme) THEME=0 ;; --image) IMG=1; NOPKG=1 ;; esac; done

msg() { echo "[vpnhub] $*"; }
die() { echo "[vpnhub] ERROR: $*" >&2; exit 1; }
fetch() {
	# fetch <url> <file>
	if command -v curl >/dev/null 2>&1; then curl -fsSL -m 90 -o "$2" "$1" 2>/dev/null
	else wget -q -T 90 -O "$2" "$1" 2>/dev/null; fi
}

fetchbig() {
	# fetch a large file: <url> <file>
	if command -v curl >/dev/null 2>&1; then curl -fsSL -m 1200 -o "$2" "$1" 2>/dev/null
	else wget -q -T 60 -O "$2" "$1" 2>/dev/null; fi
}

[ "$(id -u)" = 0 ] || die "run this as root"
[ -f /etc/openwrt_release ] || die "this is not an OpenWrt system"
command -v nft >/dev/null 2>&1 && [ -x /sbin/fw4 ] || die "the nftables firewall (fw4) is required: OpenWrt 22.03 or newer"
[ -d /www/luci-static ] || msg "warning: LuCI was not found; the web pages will not be visible, the vpnhub command still works"

# ---------------------------------------------------------------- where the files come from
HERE=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
SRC=""
[ -n "$VPNHUB_SRC" ] && SRC=$VPNHUB_SRC
[ -z "$SRC" ] && [ -f "$HERE/files.txt" ] && [ -d "$HERE/files" ] && SRC=$HERE
TMP=/tmp/vpnhub-install; rm -rf $TMP; mkdir -p $TMP
if [ $IMG = 1 ]; then
	cp /usr/share/vpnhub/files.txt $TMP/files.txt || die "the image carries no file list"
elif [ -n "$SRC" ]; then
	msg "installing from the local folder $SRC"
	cp "$SRC/files.txt" $TMP/files.txt
else
	for b in $BASES; do
		if fetch "$b/files.txt" $TMP/files.txt && grep -q '^usr/bin/vpnhub$' $TMP/files.txt; then BASE=$b; break; fi
	done
	[ -n "$BASE" ] || die "could not download the file list from GitHub (tried: $BASES)"
	msg "downloading from $BASE"
fi
# download everything first, so a broken connection never leaves a half-installed system
[ $IMG = 1 ] || while read -r f; do
	[ -n "$f" ] || continue
	mkdir -p "$TMP/files/$(dirname "$f")"
	if [ -n "$SRC" ]; then cp "$SRC/files/$f" "$TMP/files/$f" || die "missing file $f"
	else fetch "$BASE/files/$f" "$TMP/files/$f" && [ -s "$TMP/files/$f" ] || die "could not download $f"; fi
done < $TMP/files.txt

# ---------------------------------------------------------------- packages
HAD_XFRM=0; [ -f /lib/netifd/proto/xfrm.sh ] && HAD_XFRM=1
HAD_L2TP=0; [ -f /lib/netifd/proto/l2tp.sh ] && HAD_L2TP=1
HAD_SSTP=0; [ -f /lib/netifd/proto/sstp.sh ] && HAD_SSTP=1
FAILED=""
if [ $NOPKG = 0 ]; then
	if command -v apk >/dev/null 2>&1; then PM=apk; elif command -v opkg >/dev/null 2>&1; then PM=opkg; else die "no package manager found"; fi
	USE_MIRROR=0
	if command -v curl >/dev/null 2>&1; then curl -fsS -m 15 -o /dev/null https://downloads.openwrt.org/releases/ 2>/dev/null || USE_MIRROR=1
	else wget -q -T 15 -O /dev/null https://downloads.openwrt.org/releases/ 2>/dev/null || USE_MIRROR=1; fi
	if [ $PM = apk ]; then
		APK="apk"
		if [ $USE_MIRROR = 1 ]; then
			msg "the official OpenWrt download site is not reachable; using the mirror $MIRROR"
			cat /etc/apk/repositories.d/*.list 2>/dev/null | grep 'downloads.openwrt.org' | sed "s#downloads.openwrt.org#$MIRROR#" > $TMP/repos
			APK="apk --repositories-file $TMP/repos"
		fi
		pm_update() { $APK update >/dev/null 2>&1; }
		pm_has() { apk info -e "$1" >/dev/null 2>&1; }
		# Every package vpnhub needs, built for this exact OpenWrt release and device, is published as one file with the
		# releases of this project. When there is such a file for this router, packages are installed from it; whatever
		# is not in it (or when there is no such file) comes from the OpenWrt feeds as before.
		BUNDLE=""
		. /etc/openwrt_release
		BN="vpnhub-pkgs-$DISTRIB_RELEASE-$(echo "$DISTRIB_TARGET" | tr '/' '_').tar.gz"
		msg "looking for the vpnhub package bundle of this router ($BN)"
		if fetchbig "https://github.com/$REPO/releases/download/openwrt-$DISTRIB_RELEASE/$BN" $TMP/pkgs.tgz && mkdir -p $TMP/pkgs \
			&& tar -xzf $TMP/pkgs.tgz -C $TMP/pkgs 2>/dev/null && [ -f $TMP/pkgs/packages.adb ]; then
			BUNDLE=$TMP/pkgs; : > $TMP/norepo
			msg "bundle found: packages are installed from it"
		else
			msg "no bundle for this release and device: packages come from the OpenWrt feeds"
		fi
		rm -f $TMP/pkgs.tgz
		pm_add() {
			if [ -n "$BUNDLE" ]; then
				# from the bundle alone first, so nothing has to be reachable but GitHub
				apk add --allow-untrusted --force-overwrite --repositories-file $TMP/norepo --repository $BUNDLE/packages.adb "$@" >/dev/null 2>&1 && return 0
				$APK add --allow-untrusted --force-overwrite --repository $BUNDLE/packages.adb "$@" >/dev/null 2>&1
				return
			fi
			# sstp-client and ppp both ship the same empty /etc/ppp/chap-secrets
			$APK add --force-overwrite "$@" >/dev/null 2>&1
		}
		in_bundle() { [ -n "$BUNDLE" ] && ls $BUNDLE/$1-[0-9]*.apk >/dev/null 2>&1; }
		pm_file() { $APK add --allow-untrusted "$@" >/dev/null 2>&1; }
		PEXT=apk
		pm_del() { apk del "$@" >/dev/null 2>&1; }
	else
		OPKG="opkg"
		if [ $USE_MIRROR = 1 ]; then
			msg "the official OpenWrt download site is not reachable; using the mirror $MIRROR"
			{ grep -v '^src' /etc/opkg.conf; sed "s#downloads.openwrt.org#$MIRROR#" /etc/opkg/distfeeds.conf; } > $TMP/opkg.conf
			OPKG="opkg -f $TMP/opkg.conf"
		fi
		pm_update() { $OPKG update >/dev/null 2>&1; }
		pm_has() { opkg status "$1" 2>/dev/null | grep -q '^Status:.* installed'; }
		BUNDLE=""
		in_bundle() { return 1; }
		pm_add() { $OPKG install "$@" >/dev/null 2>&1; }
		pm_file() { $OPKG install "$@" >/dev/null 2>&1; }
		PEXT=ipk
		pm_del() { opkg remove "$@" >/dev/null 2>&1; }
	fi
	msg "reading the package lists ..."
	pm_update || [ -n "$BUNDLE" ] || msg "warning: the package lists could not be fully updated"
	need() {
		for p in "$@"; do
			pm_has "$p" && continue
			msg "installing $p"
			pm_add "$p"
			# some systems report an old unrelated error on every run, so look at the result instead of the exit code
			pm_has "$p" || FAILED="$FAILED $p"
		done
	}
	need curl ca-bundle ip-full
	command -v base64 >/dev/null 2>&1 || command -v openssl >/dev/null 2>&1 || need coreutils-base64
	need strongswan-swanctl strongswan-charon strongswan-mod-aes strongswan-mod-des strongswan-mod-sha1 strongswan-mod-sha2 \
		strongswan-mod-md4 strongswan-mod-hmac strongswan-mod-gcm strongswan-mod-kdf strongswan-mod-openssl strongswan-mod-pem \
		strongswan-mod-pkcs1 strongswan-mod-pubkey strongswan-mod-random strongswan-mod-x509 strongswan-mod-revocation \
		strongswan-mod-constraints strongswan-mod-eap-identity strongswan-mod-eap-mschapv2 strongswan-mod-kernel-netlink \
		strongswan-mod-socket-default strongswan-mod-updown strongswan-mod-vici strongswan-mod-resolve kmod-xfrm-interface xfrm
	need xl2tpd
	pm_has openvpn-mbedtls || pm_has openvpn-wolfssl || need openvpn-openssl
	need kmod-wireguard wireguard-tools
	need sstp-client
	# AmneziaWG is not in the official feeds: prebuilt packages for this exact release and device come from
	# the community project github.com/Slava-Shchipunov/awg-openwrt
	if [ $NOAWG = 0 ] && ! command -v awg >/dev/null 2>&1 && in_bundle kmod-amneziawg; then
		msg "installing AmneziaWG"
		pm_add kmod-amneziawg amneziawg-tools
	fi
	if [ $NOAWG = 0 ] && ! command -v awg >/dev/null 2>&1; then
		. /etc/openwrt_release
		AWGB="https://github.com/Slava-Shchipunov/awg-openwrt/releases/download/v$DISTRIB_RELEASE"
		AWGS="_v${DISTRIB_RELEASE}_${DISTRIB_ARCH}_$(echo "$DISTRIB_TARGET" | tr '/' '_').$PEXT"
		msg "downloading AmneziaWG for OpenWrt $DISTRIB_RELEASE ($DISTRIB_TARGET)"
		if fetch "$AWGB/kmod-amneziawg$AWGS" "$TMP/kmod-amneziawg.$PEXT" && fetch "$AWGB/amneziawg-tools$AWGS" "$TMP/amneziawg-tools.$PEXT"; then
			pm_file "$TMP/kmod-amneziawg.$PEXT" "$TMP/amneziawg-tools.$PEXT"
			command -v awg >/dev/null 2>&1 || FAILED="$FAILED amneziawg"
		else
			msg "warning: no AmneziaWG build was found for this release and device; the AmneziaWG page will not work"
		fi
	fi
	# sing-box (the V2Ray page) is large: only where there is room for it
	if [ $NOSB = 0 ] && ! command -v sing-box >/dev/null 2>&1; then
		FREE=$(df -k /overlay 2>/dev/null | awk 'NR == 2 { print $4 }'); [ -n "$FREE" ] || FREE=$(df -k / | awk 'NR == 2 { print $4 }')
		if [ "${FREE:-0}" -ge 60000 ]; then
			need kmod-tun sing-box
			/etc/init.d/sing-box stop >/dev/null 2>&1; /etc/init.d/sing-box disable >/dev/null 2>&1
		else
			msg "not enough free storage for sing-box (about 40 MB); the V2Ray page will not work on this router"
		fi
	fi
	# Xray (about 35 MB): runs the V2Ray links sing-box cannot read (VLESS encryption) and, when present, every
	# vless/vmess/trojan/ss link (TLS fragment against filtering, better speed). It comes only with the bundle.
	if [ $NOSB = 0 ] && ! command -v xray >/dev/null 2>&1 && [ -n "$BUNDLE" ] && [ -s $BUNDLE/xray ]; then
		FREE=$(df -k /overlay 2>/dev/null | awk 'NR == 2 { print $4 }'); [ -n "$FREE" ] || FREE=$(df -k / | awk 'NR == 2 { print $4 }')
		if [ "${FREE:-0}" -ge 60000 ]; then
			msg "installing Xray"
			cp $BUNDLE/xray /usr/bin/xray.new && chmod 755 /usr/bin/xray.new && mv /usr/bin/xray.new /usr/bin/xray
		else
			msg "not enough free storage for Xray (about 35 MB); V2Ray links that need it will not work on this router"
		fi
	fi
	# how much each device uses (Bandwidth Monitor) and history graphs of traffic, load and ping (Statistics)
	[ $NOSTATS = 1 ] || need nlbwmon luci-app-nlbwmon luci-app-statistics collectd-mod-ping collectd-mod-rrdtool collectd-mod-interface
	[ $THEME = 1 ] && need luci-i18n-base-fa luci-i18n-firewall-fa luci-i18n-package-manager-fa
	# domain based rules need dnsmasq with nftset support
	if [ $KEEPDNS = 0 ] && ! dnsmasq -v 2>/dev/null | grep -q ' nftset'; then
		msg "replacing dnsmasq with dnsmasq-full (needed for domain based rules)"
		# the router looks names up through dnsmasq itself: while it is gone, ask the upstream servers directly
		if [ -L /etc/resolv.conf ] && [ -s /tmp/resolv.conf.d/resolv.conf.auto ]; then
			cp /tmp/resolv.conf /tmp/resolv.conf.vpnhub 2>/dev/null
			{ grep nameserver /tmp/resolv.conf.d/resolv.conf.auto; echo "nameserver 1.1.1.1"; } > /tmp/resolv.conf
		fi
		if [ $PM = apk ]; then
			{ in_bundle dnsmasq-full || $APK fetch -o $TMP dnsmasq-full >/dev/null 2>&1; } && pm_del dnsmasq && { pm_add dnsmasq-full || pm_add dnsmasq; }
		else
			( cd $TMP && $OPKG download dnsmasq-full >/dev/null 2>&1 ) && pm_del dnsmasq && { pm_add dnsmasq-full || pm_add dnsmasq; }
		fi
		dnsmasq -v 2>/dev/null | grep -q ' nftset' || msg "warning: dnsmasq-full could not be installed; domain names in the direct/tunnel lists will only work partly"
		[ -f /tmp/resolv.conf.vpnhub ] && mv /tmp/resolv.conf.vpnhub /tmp/resolv.conf
		/etc/init.d/dnsmasq enable >/dev/null 2>&1
		/etc/init.d/dnsmasq restart >/dev/null 2>&1
	fi
fi

# ---------------------------------------------------------------- files
msg "copying files"
[ $IMG = 1 ] || while read -r f; do
	[ -n "$f" ] || continue
	mkdir -p "/$(dirname "$f")"
	cp "$TMP/files/$f" "/$f.vpnhub-new" && mv "/$f.vpnhub-new" "/$f"
	case "$f" in usr/bin/*|etc/init.d/*|etc/hotplug.d/*|usr/lib/vpnhub/*|www/cgi-bin/*) chmod 755 "/$f" ;; *) chmod 644 "/$f" ;; esac
done < $TMP/files.txt
mkdir -p /etc/vpnhub/profiles /etc/vpnhub/bodies
chmod 700 /etc/vpnhub /etc/vpnhub/profiles /etc/vpnhub/bodies
[ -f /etc/vpnhub/settings ] || printf 'IRAN_DIRECT=1\nALL_DEVICES=1\n' > /etc/vpnhub/settings
[ -f /etc/vpnhub/active ] || : > /etc/vpnhub/active
[ -f /etc/vpnhub/direct ] || cp /usr/share/vpnhub/default-direct.txt /etc/vpnhub/direct

# ---------------------------------------------------------------- the Hub look
if [ -d /www/luci-static/hub ] && uci -q get luci.themes >/dev/null; then
	uci set luci.themes.Hub='/luci-static/hub'
	if [ $THEME = 1 ]; then
		[ -s /www/luci-static/hub/Vazirmatn.woff2 ] || { [ -n "$BUNDLE" ] && [ "$(head -c 4 $BUNDLE/Vazirmatn.woff2 2>/dev/null)" = wOF2 ] && cp $BUNDLE/Vazirmatn.woff2 /www/luci-static/hub/Vazirmatn.woff2; }
		# flag pictures for Windows (the flags font is small and only draws flags)
		[ -s /www/luci-static/hub/flags.woff2 ] || { [ -n "$BUNDLE" ] && [ "$(head -c 4 $BUNDLE/flags.woff2 2>/dev/null)" = wOF2 ] && cp $BUNDLE/flags.woff2 /www/luci-static/hub/flags.woff2; }
		if [ ! -s /www/luci-static/hub/flags.woff2 ]; then
			for u in $FLAG_URLS; do fetch "$u" $TMP/flags.woff2 && [ "$(head -c 4 $TMP/flags.woff2)" = wOF2 ] && { cp $TMP/flags.woff2 /www/luci-static/hub/flags.woff2; break; }; done
		fi
		if [ ! -s /www/luci-static/hub/Vazirmatn.woff2 ]; then
			for u in $FONT_URLS; do fetch "$u" $TMP/font.woff2 && [ "$(head -c 4 $TMP/font.woff2)" = wOF2 ] && { cp $TMP/font.woff2 /www/luci-static/hub/Vazirmatn.woff2; break; }; done
			[ -s /www/luci-static/hub/Vazirmatn.woff2 ] || msg "warning: the Vazirmatn font could not be downloaded; the panel uses the system font until you run the installer again"
		fi
		uci set luci.main.mediaurlbase='/luci-static/hub'
		# English first; the EN / FA switch at the top of every page changes it
		[ $IMG = 1 ] && uci set luci.main.lang='en'
		[ "$(uci -q get luci.main.lang)" = auto ] && uci set luci.main.lang='en'
	fi
	uci commit luci
fi

# ---------------------------------------------------------------- strongSwan (IKEv2 and L2TP/IPsec)
if [ -d /etc/swanctl ]; then
	mkdir -p /etc/swanctl/conf.d /etc/swanctl/x509ca /etc/strongswan.d
	# strongSwan only trusts certificates in its own folder: give it the system's trusted roots, one per file
	if ! ls /etc/swanctl/x509ca/sys-*.pem >/dev/null 2>&1 && [ -s /etc/ssl/certs/ca-certificates.crt ]; then
		awk -v d=/etc/swanctl/x509ca '/BEGIN CERTIFICATE/ { n++; f = sprintf("%s/sys-%03d.pem", d, n) } f != "" { print > f } /END CERTIFICATE/ { close(f); f = "" }' /etc/ssl/certs/ca-certificates.crt
	fi
	printf 'charon {\n\tinstall_virtual_ip_on = vhike\n\tretransmit_tries = 3\n}\n' > /etc/strongswan.d/vpnhub.conf
	[ -f /etc/config/ipsec ] || : > /etc/config/ipsec
	uci -q get ipsec.@ipsec[0] >/dev/null || uci add ipsec ipsec >/dev/null
	uci set ipsec.@ipsec[0].rtinstall_enabled='0'
	uci commit ipsec
fi

# ---------------------------------------------------------------- network interfaces and firewall
msg "setting up the network interfaces and the firewall zone"
# The IKEv2 device (vhike) is not a network interface of netifd any more: vpnhub creates it itself and never deletes it.
# Deleting a vhike that has carried IPsec traffic hangs the 6.12 kernel for good ("waiting for vhike to become free")
# until a power cycle, and netifd deleted it on every reload of the network settings and whenever the modem link dropped.
# On a router where vhike is in use right now it is not touched (that would trigger the hang): vpnhub moves it out of
# netifd at the next start of the router, before any tunnel runs.
if [ $IMG = 1 ] || ! ip link show vhike >/dev/null 2>&1; then uci -q delete network.vhike; fi
uci -q batch <<'EOF'
set network.vhl2tp=interface
set network.vhl2tp.proto='l2tp'
set network.vhl2tp.auto='0'
set network.vhl2tp.defaultroute='0'
set network.vhl2tp.peerdns='0'
set network.vhl2tp.ipv6='0'
set network.vhl2tp.mtu='1380'
set network.vhl2tp.checkup_interval='30'
set network.vhsstp=interface
set network.vhsstp.proto='sstp'
set network.vhsstp.auto='0'
set network.vhsstp.defaultroute='0'
set network.vhsstp.peerdns='0'
set network.vhsstp.ipv6='0'
set network.vhsstp.mtu='1380'
commit network
delete firewall.vpnhub
set firewall.vpnhub=zone
set firewall.vpnhub.name='vpnhub'
set firewall.vpnhub.input='REJECT'
set firewall.vpnhub.output='ACCEPT'
set firewall.vpnhub.forward='REJECT'
set firewall.vpnhub.masq='1'
set firewall.vpnhub.mtu_fix='1'
add_list firewall.vpnhub.device='vhike'
add_list firewall.vpnhub.network='vhl2tp'
add_list firewall.vpnhub.network='vhsstp'
add_list firewall.vpnhub.device='vhovpn'
add_list firewall.vpnhub.device='vhwg'
add_list firewall.vpnhub.device='vhawg'
add_list firewall.vpnhub.device='vhsb'
add_list firewall.vpnhub.device='vhx1'
add_list firewall.vpnhub.device='vhx2'
add_list firewall.vpnhub.device='vhx3'
add_list firewall.vpnhub.device='vhx4'
add_list firewall.vpnhub.device='vhx5'
delete firewall.vpnhub_sb
set firewall.vpnhub_sb=rule
set firewall.vpnhub_sb.name='vpnhub-singbox-local'
set firewall.vpnhub_sb.src='vpnhub'
set firewall.vpnhub_sb.src_ip='172.19.0.0/16'
set firewall.vpnhub_sb.dest_ip='172.19.0.0/16'
set firewall.vpnhub_sb.proto='all'
set firewall.vpnhub_sb.target='ACCEPT'
set firewall.vpnhub_fwd=forwarding
set firewall.vpnhub_fwd.src='lan'
set firewall.vpnhub_fwd.dest='vpnhub'
commit firewall
EOF

# ---------------------------------------------------------------- usage monitor and graphs: their data lives on the flash, not in
# memory, so a restart does not wipe a month of counting (written every 6 hours / every few minutes: no strain on the flash)
if [ -f /etc/config/nlbwmon ]; then
	mkdir -p /root/nlbwmon
	uci set nlbwmon.@nlbwmon[0].database_directory='/root/nlbwmon'
	uci set nlbwmon.@nlbwmon[0].commit_interval='6h'
	uci commit nlbwmon
	[ $IMG = 1 ] || /etc/init.d/nlbwmon restart >/dev/null 2>&1
fi
if [ -f /etc/config/luci_statistics ]; then
	mkdir -p /root/rrd
	uci set luci_statistics.collectd_rrdtool.DataDir='/root/rrd'
	# the graphs service stops altogether when a plugin is switched on whose module is missing
	if [ -f /usr/lib/collectd/ping.so ]; then uci set luci_statistics.collectd_ping.enable='1'; else uci set luci_statistics.collectd_ping.enable='0'; fi
	uci -q get luci_statistics.collectd_ping.Hosts | grep -q 1.1.1.1 || uci set luci_statistics.collectd_ping.Hosts='1.1.1.1 8.8.8.8'
	uci commit luci_statistics
	[ $IMG = 1 ] || /etc/init.d/luci_statistics restart >/dev/null 2>&1
fi

# ---------------------------------------------------------------- watchdog, boot, upgrade survival
touch /etc/crontabs/root
grep -q '/usr/bin/vpnhub watchdog' /etc/crontabs/root || echo '* * * * * /usr/bin/vpnhub watchdog' >> /etc/crontabs/root
/etc/init.d/cron enable >/dev/null 2>&1; [ $IMG = 1 ] || /etc/init.d/cron restart >/dev/null 2>&1
/etc/init.d/vpnhub enable
grep -qE '^LED_MODE=(rgb|single)' /etc/vpnhub/led 2>/dev/null && { /etc/init.d/vpnhub-led enable; [ $IMG = 1 ] || /etc/init.d/vpnhub-led restart >/dev/null 2>&1; }
{ sed 's#^#/#' $TMP/files.txt; echo /etc/vpnhub/; echo /etc/strongswan.d/vpnhub.conf; echo /etc/swanctl/x509ca/; echo /root/nlbwmon/; echo /root/rrd/; echo /usr/bin/xray; } > /lib/upgrade/keep.d/vpnhub

# ---------------------------------------------------------------- activate
# on the first boot of an image the services are not running yet; they start with the new settings by themselves
if [ $IMG = 1 ]; then
	/etc/init.d/sing-box disable >/dev/null 2>&1
	rm -rf $TMP
	exit 0
fi
/etc/init.d/firewall reload >/dev/null 2>&1
NOW_XFRM=0; [ -f /lib/netifd/proto/xfrm.sh ] && NOW_XFRM=1
NOW_L2TP=0; [ -f /lib/netifd/proto/l2tp.sh ] && NOW_L2TP=1
NOW_SSTP=0; [ -f /lib/netifd/proto/sstp.sh ] && NOW_SSTP=1
if [ "$HAD_XFRM$HAD_L2TP$HAD_SSTP" != "$NOW_XFRM$NOW_L2TP$NOW_SSTP" ]; then
	msg "restarting the network once (new tunnel types were added); the connection drops for a few seconds"
	( sleep 2; /etc/init.d/network restart ) >/dev/null 2>&1 &
else
	/etc/init.d/network reload >/dev/null 2>&1
fi
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache
# browsers keep the panel's scripts until the package database changes its date: make them fetch the new pages
for f in /lib/apk/db/installed /usr/lib/opkg/status; do [ -f $f ] && touch $f; done
/etc/init.d/rpcd restart >/dev/null 2>&1
rm -rf $TMP

msg "done. vpnhub $(/usr/bin/vpnhub version) is installed."
[ -n "$FAILED" ] && msg "these packages could not be installed:$FAILED"
# say plainly what this router can do now, so a missing piece is never found out later
BAD=""
chk() { if eval "$2" >/dev/null 2>&1; then msg "  ready    $1"; else msg "  MISSING  $1"; BAD="$BAD $1"; fi; }
msg "tunnel types on this router:"
chk IKEv2 'command -v swanctl && [ -f /lib/netifd/proto/xfrm.sh ]'
chk L2TP 'command -v xl2tpd'
chk OpenVPN 'command -v openvpn'
chk WireGuard 'command -v wg'
[ $NOAWG = 1 ] || chk AmneziaWG 'command -v awg'
chk SSTP 'command -v sstpc'
[ $NOSB = 1 ] || chk V2Ray 'command -v sing-box'
[ $NOSB = 1 ] || chk Xray 'command -v xray'
[ $NOSTATS = 1 ] || chk usage-monitor 'command -v nlbw'
[ $KEEPDNS = 1 ] || chk site-rules "dnsmasq -v | grep -q ' nftset'"
if [ -n "$BAD" ]; then msg "not everything could be installed ($BAD ). Check the internet connection and run the same command again; what is ready already works."
else msg "everything is ready."; fi
msg "open the router's web panel, log in again, and look under the VPN menu."
