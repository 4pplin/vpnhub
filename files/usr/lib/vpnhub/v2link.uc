#!/usr/bin/ucode
// vpnhub - reads share links (vless, vmess, trojan, ss, hysteria2, tuic) and turns them into a sing-box config.
//   v2link.uc info <file>              one line per input line: ok|host|port|kind|name   or   bad|reason   or   skip
//   v2link.uc conf <file> <ip> <dev> [addr]   sing-box config (JSON) for the first link in the file; <ip> replaces the server name
import { readfile } from 'fs';

function pct(s) {
	return replace(s ?? '', /%([0-9A-Fa-f][0-9A-Fa-f])/g, (m, h) => chr(hex(h)));
}

function b64(s) {
	s = replace(replace(trim(s ?? ''), /-/g, '+'), /_/g, '/');
	s = replace(s, /=+$/, '');
	while (length(s) % 4) s += '=';
	return b64dec(s);
}

function is_ip(h) { return !!match(h ?? '', /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/); }

function hostport(u, rest) {
	let m = match(rest, /^([A-Za-z0-9.-]+):([0-9]+)/);
	if (!m) return false;
	u.host = m[1]; u.port = int(m[2]);
	return u.port > 0 && u.port < 65536;
}

function parse_url(l) {
	let m = match(l, /^([A-Za-z0-9]+):\/\/([^#]*)(#(.*))?$/);
	if (!m) return null;
	let u = { scheme: lc(m[1]), name: trim(pct(m[4])), q: {}, user: '' };
	let rest = m[2], qi = index(rest, '?');
	if (qi >= 0) {
		for (let kv in split(substr(rest, qi + 1), '&')) {
			let e = index(kv, '=');
			if (e > 0) u.q[lc(substr(kv, 0, e))] = pct(substr(kv, e + 1));
		}
		rest = substr(rest, 0, qi);
	}
	u.raw = rest;
	let at = rindex(rest, '@');
	if (at >= 0) { u.user = pct(substr(rest, 0, at)); rest = substr(rest, at + 1); }
	u.ok = hostport(u, rest);
	return u;
}

function tls_of(q, host, always) {
	let sec = lc(q.security ?? '');
	if (sec != 'tls' && sec != 'reality' && !always) return null;
	let t = { enabled: true };
	let sn = q.sni || q.peer || q.host || host;
	if (sn && !is_ip(sn)) t.server_name = split(sn, ',')[0];
	if (q.allowinsecure == '1' || q.insecure == '1' || q.allowinsecure == 'true') t.insecure = true;
	if (q.alpn) t.alpn = split(q.alpn, ',');
	if (sec == 'reality') {
		t.reality = { enabled: true, public_key: q.pbk ?? '', short_id: q.sid ?? '' };
		t.utls = { enabled: true, fingerprint: q.fp || 'chrome' };
	} else if (q.fp) {
		t.utls = { enabled: true, fingerprint: q.fp };
	}
	return t;
}

// returns a transport object, null for plain TCP, or a string naming what is not supported
function transport_of(net, q, host) {
	net = lc(net || 'tcp');
	let h = q.host || (is_ip(host) ? null : host);
	if (net == 'ws') {
		let t = { type: 'ws', path: q.path || '/' };
		let em = match(t.path, /^(.*)[?&]ed=([0-9]+)$/);
		if (em) { t.path = em[1] || '/'; t.max_early_data = int(em[2]); t.early_data_header_name = 'Sec-WebSocket-Protocol'; }
		if (h) t.headers = { Host: h };
		return t;
	}
	if (net == 'grpc') return { type: 'grpc', service_name: q.servicename || q.path || '' };
	if (net == 'httpupgrade') {
		let t = { type: 'httpupgrade', path: q.path || '/' };
		if (h) t.host = h;
		return t;
	}
	if (net == 'h2' || net == 'http') {
		let t = { type: 'http', path: q.path || '/' };
		if (h) t.host = split(h, ',');
		return t;
	}
	if (net == 'tcp' || net == 'raw') {
		if (lc(q.headertype ?? '') == 'http') {
			let t = { type: 'http', path: q.path || '/' };
			if (h) t.host = split(h, ',');
			return t;
		}
		return null;
	}
	return net;
}

// returns { ob: sing-box outbound, host, port, kind, name } or { err: reason }
function build(l) {
	let sc = lc(match(l, /^([A-Za-z0-9]+):\/\//)?.[1] ?? '');
	let ob, u, kind, net = 'tcp', tls = null, tr = null;

	if (sc == 'vmess') {
		let j;
		try { j = json(b64(substr(l, 8))); } catch (e) { j = null; }
		if (type(j) != 'object') return { err: 'vmess link could not be read' };
		u = { host: `${j.add ?? ''}`, port: int(j.port), name: trim(`${j.ps ?? ''}`) };
		if (!match(u.host, /^[A-Za-z0-9.-]+$/) || !(u.port > 0)) return { err: 'no server in the link' };
		let q = { security: j.tls, sni: j.sni, host: j.host, path: j.path, alpn: j.alpn, fp: j.fp, headertype: j.type, servicename: j.path, allowinsecure: `${j.allowInsecure ?? ''}` };
		for (let k in keys(q)) if (q[k] == null || q[k] == '') delete q[k]; else q[k] = `${q[k]}`;
		net = j.net || 'tcp';
		ob = { type: 'vmess', uuid: `${j.id ?? ''}`, security: j.scy || 'auto', alter_id: int(j.aid) || 0 };
		tls = tls_of(q, u.host, false); tr = transport_of(net, q, u.host);
	} else {
		u = parse_url(l);
		if (!u) return { err: 'not a link' };
		let q = u.q;
		if (sc == 'vless') {
			if (!u.ok || !u.user) return { err: 'no server in the link' };
			net = q.type || 'tcp';
			ob = { type: 'vless', uuid: u.user, packet_encoding: 'xudp' };
			if (q.flow) ob.flow = q.flow;
			tls = tls_of(q, u.host, false); tr = transport_of(net, q, u.host);
		} else if (sc == 'trojan') {
			if (!u.ok || !u.user) return { err: 'no server in the link' };
			net = q.type || 'tcp';
			ob = { type: 'trojan', password: u.user };
			tls = tls_of(q, u.host, lc(q.security ?? '') != 'none'); tr = transport_of(net, q, u.host);
		} else if (sc == 'ss') {
			if (q.plugin) return { err: 'shadowsocks plugins are not supported' };
			let cred = u.user;
			if (!u.ok) {
				// whole part is base64: method:password@host:port
				let d = b64(u.raw) ?? '';
				let at = rindex(d, '@');
				if (at < 0 || !hostport(u, substr(d, at + 1))) return { err: 'no server in the link' };
				cred = substr(d, 0, at);
			} else if (index(cred, ':') < 0) {
				cred = b64(cred) ?? '';
			}
			let c = index(cred, ':');
			if (c < 1) return { err: 'shadowsocks link could not be read' };
			ob = { type: 'shadowsocks', method: substr(cred, 0, c), password: substr(cred, c + 1) };
		} else if (sc == 'hysteria2' || sc == 'hy2') {
			if (!u.ok) return { err: 'no server in the link' };
			sc = 'hysteria2';
			ob = { type: 'hysteria2', password: u.user };
			if (q.obfs && q.obfs != 'none') ob.obfs = { type: q.obfs, password: q['obfs-password'] ?? '' };
			tls = tls_of(q, u.host, true);
		} else if (sc == 'tuic') {
			if (!u.ok) return { err: 'no server in the link' };
			let c = index(u.user, ':');
			ob = { type: 'tuic', uuid: c > 0 ? substr(u.user, 0, c) : u.user, password: c > 0 ? substr(u.user, c + 1) : '',
				congestion_control: q.congestion_control || 'bbr', udp_relay_mode: q.udp_relay_mode || 'native' };
			tls = tls_of(q, u.host, true);
		} else {
			return { err: `${sc || 'this kind of'} link is not supported` };
		}
	}
	if (type(tr) == 'string') return { err: `transport "${tr}" is not supported` };
	if (tls) ob.tls = tls;
	if (tr) ob.transport = tr;
	kind = sc;
	if (tr) kind += '-' + tr.type;
	if (tls) kind += tls.reality ? '-reality' : '-tls';
	ob.tag = 'proxy';
	return { ob, host: u.host, port: u.port, kind, name: u.name || u.host };
}

let mode = ARGV[0], text = readfile(ARGV[1] ?? '') ?? '';
let lines = split(replace(text, /\r/g, ''), '\n');
if (length(lines) && lines[length(lines) - 1] == '') pop(lines);

if (mode == 'info') {
	for (let l in lines) {
		l = trim(l);
		if (l == '') { print('skip\n'); continue; }
		let r = build(l);
		if (r.err) print('bad|', r.err, '\n');
		else print('ok|', r.host, '|', r.port, '|', r.kind, '|', replace(r.name, /[|\n]/g, ' '), '\n');
	}
} else if (mode == 'conf') {
	let l = '';
	for (let x in lines) if (trim(x) != '') { l = trim(x); break; }
	let r = build(l);
	if (r.err) { warn(r.err, '\n'); exit(1); }
	r.ob.server = ARGV[2] || r.host;
	r.ob.server_port = r.port;
	print({
		log: { level: 'warn', timestamp: false },
		inbounds: [ { type: 'tun', tag: 'tun', interface_name: ARGV[3] || 'vhsb', address: [ ARGV[4] || '172.19.0.1/30' ], mtu: 1500, auto_route: false } ],
		outbounds: [ r.ob ],
		route: { final: 'proxy' }
	}, '\n');
} else {
	warn('usage: v2link.uc info <file> | conf <file> <ip> <dev>\n');
	exit(1);
}
