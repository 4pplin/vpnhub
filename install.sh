#!/bin/sh
# vpnhub installer for OpenWrt (22.03 or newer, with LuCI and the nftables firewall).
#   wget -O /tmp/vpnhub-install.sh https://raw.githubusercontent.com/4pplin/vpnhub/main/install.sh && sh /tmp/vpnhub-install.sh
# Options:  --no-packages   do not install or change any system package
#           --keep-dnsmasq  do not replace dnsmasq with dnsmasq-full (domain rules then work only partly)
#           --no-amneziawg  do not download the AmneziaWG kernel module (it is not in the official OpenWrt feeds)
REPO=4pplin/vpnhub
BRANCH=main
BASES="https://raw.githubusercontent.com/$REPO/$BRANCH https://cdn.jsdelivr.net/gh/$REPO@$BRANCH"
MIRROR=mirrors.tuna.tsinghua.edu.cn/openwrt
NOPKG=0; KEEPDNS=0; NOAWG=0
for a in "$@"; do case "$a" in --no-packages) NOPKG=1 ;; --keep-dnsmasq) KEEPDNS=1 ;; --no-amneziawg) NOAWG=1 ;; esac; done

msg() { echo "[vpnhub] $*"; }
die() { echo "[vpnhub] ERROR: $*" >&2; exit 1; }
fetch() {
	# fetch <url> <file>
	if command -v curl >/dev/null 2>&1; then curl -fsSL -m 90 -o "$2" "$1" 2>/dev/null
	else wget -q -T 90 -O "$2" "$1" 2>/dev/null; fi
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
if [ -n "$SRC" ]; then
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
while read -r f; do
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
		pm_add() { $APK add "$@" >/dev/null 2>&1; }
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
		pm_add() { $OPKG install "$@" >/dev/null 2>&1; }
		pm_file() { $OPKG install "$@" >/dev/null 2>&1; }
		PEXT=ipk
		pm_del() { opkg remove "$@" >/dev/null 2>&1; }
	fi
	msg "reading the package lists ..."
	pm_update || msg "warning: the package lists could not be fully updated"
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
	# domain based rules need dnsmasq with nftset support
	if [ $KEEPDNS = 0 ] && ! dnsmasq -v 2>/dev/null | grep -q ' nftset'; then
		msg "replacing dnsmasq with dnsmasq-full (needed for domain based rules)"
		if [ $PM = apk ]; then
			$APK fetch -o $TMP dnsmasq-full >/dev/null 2>&1 && pm_del dnsmasq && { pm_add dnsmasq-full || pm_add dnsmasq; }
		else
			( cd $TMP && $OPKG download dnsmasq-full >/dev/null 2>&1 ) && pm_del dnsmasq && { pm_add dnsmasq-full || pm_add dnsmasq; }
		fi
		dnsmasq -v 2>/dev/null | grep -q ' nftset' || msg "warning: dnsmasq-full could not be installed; domain names in the direct/tunnel lists will only work partly"
		/etc/init.d/dnsmasq restart >/dev/null 2>&1
	fi
fi

# ---------------------------------------------------------------- files
msg "copying files"
while read -r f; do
	[ -n "$f" ] || continue
	mkdir -p "/$(dirname "$f")"
	cp "$TMP/files/$f" "/$f.vpnhub-new" && mv "/$f.vpnhub-new" "/$f"
	case "$f" in usr/bin/*|etc/init.d/*|etc/hotplug.d/*|usr/lib/vpnhub/*) chmod 755 "/$f" ;; *) chmod 644 "/$f" ;; esac
done < $TMP/files.txt
mkdir -p /etc/vpnhub/profiles /etc/vpnhub/bodies
chmod 700 /etc/vpnhub /etc/vpnhub/profiles /etc/vpnhub/bodies
[ -f /etc/vpnhub/settings ] || printf 'IRAN_DIRECT=1\nALL_DEVICES=1\n' > /etc/vpnhub/settings
[ -f /etc/vpnhub/active ] || : > /etc/vpnhub/active
[ -f /etc/vpnhub/direct ] || cp /usr/share/vpnhub/default-direct.txt /etc/vpnhub/direct

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
uci -q batch <<'EOF'
set network.vhike=interface
set network.vhike.proto='xfrm'
set network.vhike.ifid='42'
set network.vhike.tunlink='wan'
set network.vhike.mtu='1380'
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
add_list firewall.vpnhub.network='vhike'
add_list firewall.vpnhub.network='vhl2tp'
add_list firewall.vpnhub.network='vhsstp'
add_list firewall.vpnhub.device='vhovpn'
add_list firewall.vpnhub.device='vhwg'
add_list firewall.vpnhub.device='vhawg'
set firewall.vpnhub_fwd=forwarding
set firewall.vpnhub_fwd.src='lan'
set firewall.vpnhub_fwd.dest='vpnhub'
commit firewall
EOF

# ---------------------------------------------------------------- watchdog, boot, upgrade survival
touch /etc/crontabs/root
grep -q '/usr/bin/vpnhub watchdog' /etc/crontabs/root || echo '* * * * * /usr/bin/vpnhub watchdog' >> /etc/crontabs/root
/etc/init.d/cron enable >/dev/null 2>&1; /etc/init.d/cron restart >/dev/null 2>&1
/etc/init.d/vpnhub enable
grep -qE '^LED_MODE=(rgb|single)' /etc/vpnhub/led 2>/dev/null && { /etc/init.d/vpnhub-led enable; /etc/init.d/vpnhub-led restart >/dev/null 2>&1; }
{ sed 's#^#/#' $TMP/files.txt; echo /etc/vpnhub/; echo /etc/strongswan.d/vpnhub.conf; echo /etc/swanctl/x509ca/; } > /lib/upgrade/keep.d/vpnhub

# ---------------------------------------------------------------- activate
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
/etc/init.d/rpcd restart >/dev/null 2>&1
rm -rf $TMP

msg "done. vpnhub $(/usr/bin/vpnhub version) is installed."
[ -n "$FAILED" ] && msg "these packages could not be installed (the matching tunnel type will not work until they are):$FAILED"
msg "open the router's web panel, log in again, and look under the VPN menu."
