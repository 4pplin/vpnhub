'use strict';
'require baseclass';
'require view';
'require fs';
'require ui';
'require poll';

/* vpnhub - one shared page for every tunnel type. The four menu entries only differ by the type name. */

var NL = String.fromCharCode(10);
var BIN = '/usr/bin/vpnhub';
var INFILE = '/tmp/vpnhub.in';

var TYPES = {
	ikev2: {
		title: 'تونل IKEv2', name: 'IKEv2', account: true, bulk: true, body: false,
		accountHint: 'این حساب برای همهٔ سرورهایی به کار می‌رود که حساب جدا ندارند. نام کاربری و رمز IKEv2 را از سرویس‌دهندهٔ VPN خودتان بگیرید (معمولاً با رمز ورود به سایت فرق دارد).',
		bulkPlaceholder: 'vpn.example.com Frankfurt'
	},
	l2tp: {
		title: 'تونل L2TP', name: 'L2TP', account: true, bulk: true, body: false,
		accountHint: 'این حساب برای همهٔ سرورهایی به کار می‌رود که حساب جدا ندارند.',
		bulkPlaceholder: 'l2tp.example.com Istanbul'
	},
	openvpn: {
		title: 'تونل OpenVPN', name: 'OpenVPN', account: true, bulk: false, body: true,
		bodyLabel: 'متن فایل ‎.ovpn', ports: true, port: true, proto: true,
		accountHint: 'اگر سرویس‌دهندهٔ شما برای OpenVPN نام کاربری و رمز می‌خواهد، اینجا وارد کنید. برای سرورهایی به کار می‌رود که حساب جدا ندارند.'
	},
	wireguard: {
		title: 'تونل WireGuard', name: 'WireGuard', account: false, bulk: false, body: true,
		bodyLabel: 'متن فایل کانفیگ WireGuard (‎.conf)', ports: true, port: true
	},
	amneziawg: {
		title: 'تونل AmneziaWG', name: 'AmneziaWG', account: false, bulk: false, body: true,
		bodyLabel: 'متن فایل کانفیگ AmneziaWG (‎.conf، با خط‌های Jc و S1 و H1 و …)', ports: true, port: true
	},
	sstp: {
		title: 'تونل SSTP', name: 'SSTP', account: true, bulk: true, body: false, port: true,
		accountHint: 'این حساب برای همهٔ سرورهایی به کار می‌رود که حساب جدا ندارند.',
		bulkPlaceholder: 'sstp.example.com Amsterdam'
	}
};

function parse(out) {
	var o = { lease: [], prof: [] };
	(out || '').split(NL).forEach(function(l) {
		var i = l.indexOf('=');
		if (i < 0) return;
		var k = l.slice(0, i), v = l.slice(i + 1).trim();
		if (k === 'lease') {
			var p = v.split('|');
			o.lease.push({ ip: p[0], mac: p[1] || '', name: (p[2] && p[2] !== '*') ? p[2] : '' });
		} else if (k === 'prof') {
			var q = v.split('|');
			o.prof.push({ id: q[0], host: q[1] || '', ip: q[2] || '', label: q[3] || '', own: q[4] === '1', active: q[5] === '1', port: q[6] || '', proto: q[7] || '' });
		} else {
			o[k] = v;
		}
	});
	return o;
}

function ex(args) {
	return L.resolveDefault(fs.exec(BIN, args), { stdout: '' }).then(function(r) {
		return ((r && r.stdout) || '').trim();
	});
}

function csv(text) {
	var a = (text || '').split(/[\s,]+/).filter(function(x) { return x.length > 0; });
	return a.length ? a.join(',') : '-';
}

function wait(ms) {
	return new Promise(function(r) { window.setTimeout(r, ms); });
}

function bad(s) {
	return s.indexOf('"') >= 0 || s.indexOf(String.fromCharCode(92)) >= 0 || s.indexOf(NL) >= 0;
}

/* Sections that belong to the whole program, shown on the settings page. */
function busyModal(title, job) {
	ui.showModal(title, [ E('p', { 'class': 'spinning' }, 'لطفاً صبر کنید…') ]);
	return job().then(function(msg) {
		ui.hideModal();
		if (msg) ui.addNotification(null, E('p', {}, msg), 'info');
	}, function(e) {
		ui.hideModal();
		ui.addNotification(null, E('p', {}, 'خطا: ' + (e && e.message ? e.message : e)), 'danger');
	});
}

function sharedSections(d) {
	var busy = busyModal;
	var reloadAll = function() { return Promise.resolve(); };
	var sec = function(title, children) {
		return E('div', { 'class': 'cbi-section', 'style': 'margin-top:18px' }, [ E('h3', {}, title) ].concat(children));
	};
	var hint = function(t) { return E('div', { 'style': 'opacity:.75;font-size:90%;margin:2px 0 6px 0' }, t); };
	var routing = [], backup = [], page;
	/* --- routing (shared by every tunnel type) --- */
	var cbIran = E('input', { 'type': 'checkbox' });
	cbIran.checked = d.iran_direct !== '0';
	var cbAll = E('input', { 'type': 'checkbox' });
	cbAll.checked = d.all_devices !== '0';
	var iranCount = E('span', { 'dir': 'ltr' }, d.iran_count || '0');
	var iranDoms = E('span', { 'dir': 'ltr' }, d.iran_domains || '0');

	var saved = (d.devices || '').split(',').filter(function(x) { return x; });
	var rows = d.lease.slice();
	saved.forEach(function(ip) {
		if (!rows.some(function(r) { return r.ip === ip; })) rows.push({ ip: ip, mac: '', name: '' });
	});
	rows.sort(function(a, b) { return a.ip.localeCompare(b.ip, undefined, { numeric: true }); });
	var devBoxes = [];
	var devList = E('div', { 'style': 'margin:6px 0 0 0;padding:8px 12px;border:1px solid rgba(128,128,128,.35);border-radius:8px' },
		rows.length ? rows.map(function(r) {
			var cb = E('input', { 'type': 'checkbox', 'data-ip': r.ip });
			cb.checked = saved.indexOf(r.ip) >= 0;
			devBoxes.push(cb);
			return E('label', { 'style': 'display:block;margin:3px 0' }, [
				cb, ' ',
				E('span', { 'dir': 'ltr' }, r.ip),
				r.name ? E('span', {}, ' — ' + r.name) : ''
			]);
		}) : [ E('em', {}, 'دستگاهی در فهرست روتر پیدا نشد.') ]);
	function syncDev() { devList.style.display = cbAll.checked ? 'none' : ''; }
	cbAll.addEventListener('change', syncDev);
	syncDev();

	var taStyle = 'width:100%;max-width:34em;height:7em;direction:ltr;text-align:left;font-family:monospace';
	var taDirect = E('textarea', { 'class': 'cbi-input-textarea', 'style': taStyle }, (d.direct || '').split(',').filter(function(x) { return x; }).join(NL));
	var inDns = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'dir': 'ltr', 'style': 'width:18em;max-width:100%', 'placeholder': '1.1.1.1, 8.8.8.8', 'value': (d.tunnel_dns || '').split(',').filter(function(x) { return x; }).join(', ') });
	function saveDns() {
		var v = inDns.value.split(/[\s,]+/).filter(function(x) { return /^\d+\.\d+\.\d+\.\d+$/.test(x); }).join(',');
		if (inDns.value.trim() && !v) { ui.addNotification(null, E('p', {}, 'نشانی DNS باید عددی باشد، مثل 1.1.1.1'), 'warning'); return Promise.resolve(); }
		return ex(['dns-set', v || '-']).then(function(o) {
			var m = /^saved (.*)$/m.exec(o);
			ui.addNotification(null, E('p', {}, m ? 'ذخیره شد. DNS داخل تونل: ' + m[1].split(',').join(' و ') : 'ذخیره نشد. جواب روتر: ' + (o || 'خالی')), 'info');
		});
	}
	var taTunnel = E('textarea', { 'class': 'cbi-input-textarea', 'style': taStyle }, (d.tunnel || '').split(',').filter(function(x) { return x; }).join(NL));

	function save() {
		var devs = devBoxes.filter(function(c) { return c.checked; }).map(function(c) { return c.getAttribute('data-ip'); });
		if (!cbAll.checked && !devs.length) {
			ui.addNotification(null, E('p', {}, 'هیچ دستگاهی انتخاب نشده است. یا «همهٔ دستگاه‌ها» را بزنید یا دست‌کم یک دستگاه را تیک بزنید.'), 'warning');
			return Promise.resolve();
		}
		return busy('در حال ذخیره و اعمال', function() {
			return ex(['save', cbIran.checked ? '1' : '0', cbAll.checked ? '1' : '0', devs.length ? devs.join(',') : '-', csv(taDirect.value), csv(taTunnel.value)])
				.then(function(o) {
					if (/saved and applied/.test(o)) return 'ذخیره شد و همین حالا اعمال شد.';
					if (/applying failed/.test(o)) return 'ذخیره شد، ولی اعمالش خطا داد. یکی از خط‌های فهرست‌ها را بررسی کنید.';
					if (/saved/.test(o)) return 'ذخیره شد. با وصل شدن تونل اعمال می‌شود.';
					return 'جواب روتر: ' + (o || 'خالی');
				});
		});
	}

	function iranUpdate() {
		return busy('در حال به‌روزرسانی فهرست ایران', function() {
			return ex(['iran-update']).then(function(o) {
				var m = /updated ips=(\S+) domains=(\S+)/.exec(o);
				if (!m || (m[1] === '-' && m[2] === '-')) return 'به‌روزرسانی انجام نشد (فهرست تازه دانلود نشد یا درست نبود)؛ همان فهرست قبلی سر جایش است.';
				if (m[1] !== '-') iranCount.textContent = m[1];
				if (m[2] !== '-') iranDoms.textContent = m[2];
				if (m[1] === '-') return 'فهرست سایت‌ها به‌روز شد، ولی فهرست بازه‌های نشانی دانلود نشد و همان قبلی ماند.';
				if (m[2] === '-') return 'فهرست بازه‌های نشانی به‌روز شد، ولی فهرست سایت‌ها دانلود نشد و همان قبلی ماند.';
				return 'هر دو فهرست ایران به‌روز شد.';
			});
		});
	}

	/* --- backup: take the server lists to another router --- */
	var inImport = E('input', { 'type': 'file', 'accept': '.vpnhub,.gz,.tgz' });
	function doExport() {
		return busy('در حال ساختن فایل', function() {
			return ex(['export']).then(function(o) {
				var b64 = (o || '').replace(/\s+/g, '');
				if (b64.length < 40) return 'فایل ساخته نشد. جواب روتر: ' + (o || 'خالی');
				var bin = window.atob(b64), arr = new Uint8Array(bin.length);
				for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
				var url = window.URL.createObjectURL(new Blob([ arr ], { type: 'application/gzip' }));
				var a = document.createElement('a');
				a.href = url;
				a.download = 'vpnhub-servers-' + new Date().toISOString().slice(0, 10) + '.vpnhub';
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				window.setTimeout(function() { window.URL.revokeObjectURL(url); }, 5000);
				return 'فایل دانلود شد. فقط فهرست سرورها در آن است؛ نام کاربری، رمز و کلید در آن نیست.';
			});
		});
	}
	function doImport() {
		var f = inImport.files && inImport.files[0];
		if (!f) {
			ui.addNotification(null, E('p', {}, 'اول فایل پشتیبان را انتخاب کنید.'), 'warning');
			return Promise.resolve();
		}
		return busy('در حال بازگردانی', function() {
			return new Promise(function(resolve, reject) {
				var rd = new FileReader();
				rd.onload = function() { resolve(String(rd.result || '').replace(/^data:[^,]*,/, '')); };
				rd.onerror = function() { reject(new Error('فایل خوانده نشد')); };
				rd.readAsDataURL(f);
			}).then(function(b64) {
				return fs.write(INFILE, b64 + NL, 384);
			}).then(function() {
				return ex(['import']);
			}).then(function(o) {
				var m = /imported (\d+) skipped (\d+)/.exec(o);
				return reloadAll().then(function() {
					if (m) return m[1] + ' سرور از فایل وارد شد (در همهٔ صفحه‌های تونل)' + (+m[2] > 0 ? ' و ' + m[2] + ' سرور که از قبل اینجا بود دست‌نخورده ماند' : '') + '. حالا نام کاربری و رمز را در بخش «حساب پیش‌فرض» هر صفحه، و کلید وایرگارد را در بخش «کلید شخصی» وارد کنید.';
					return 'این فایل، فایل پشتیبان vpnhub نیست یا خراب است. چیزی عوض نشد.';
				});
			});
		});
	}

	page = routing;
	page.push(sec('مسیردهی', [
		E('label', { 'style': 'display:block;margin:6px 0' }, [ cbIran, ' سایت‌ها و سرویس‌های ایرانی مستقیم بروند (بدون تونل)' ]),
		hint([ 'هر مقصدی که سرورش در ایران باشد مستقیم می‌رود، به‌علاوهٔ همهٔ نشانی‌های ‎.ir و سایت‌های شناخته‌شدهٔ ایرانی که ‎.ir نیستند. فهرست فعلی: ', iranCount, ' بازهٔ نشانی و ', iranDoms, ' سایت. ',
			E('button', { 'class': 'cbi-button', 'style': 'margin-inline-start:8px', 'click': iranUpdate }, 'به‌روزرسانی فهرست') ]),
		E('label', { 'style': 'display:block;margin:10px 0 0 0' }, [ cbAll, ' همهٔ دستگاه‌های متصل به روتر از تونل استفاده کنند' ]),
		devList,
		E('div', { 'style': 'display:flex;gap:18px;flex-wrap:wrap;margin-top:14px' }, [
			E('div', { 'style': 'flex:1;min-width:16em' }, [
				E('strong', {}, 'همیشه مستقیم'),
				hint('هر خط یک مورد: دامنه، نشانی یا بازهٔ نشانی. این‌ها هیچ‌وقت از تونل نمی‌روند. این فهرست مال خود شماست و به‌روزرسانی به آن دست نمی‌زند.'),
				taDirect
			]),
			E('div', { 'style': 'flex:1;min-width:16em' }, [
				E('strong', {}, 'همیشه از تونل'),
				hint('هر خط یک مورد. این‌ها همیشه از تونل می‌روند، حتی اگر سرورشان در ایران باشد.'),
				taTunnel
			])
		]),
		E('div', { 'style': 'margin-top:12px' }, [
			E('button', { 'class': 'cbi-button cbi-button-save', 'click': save }, 'ذخیره و اعمال')
		]),
		hint('بعد از تغییر فهرست دامنه‌ها، ممکن است چند دقیقه طول بکشد تا دستگاه‌ها نشانی تازه را بگیرند.'),
		E('div', { 'style': 'margin-top:16px' }, [ E('strong', {}, 'DNS داخل تونل') ]),
		hint('وقتی تونل روشن است، اسم سایت‌ها از داخل تونل از این نشانی‌ها پرسیده می‌شود. اگر خالی باشد 1.1.1.1 و 8.8.8.8 به کار می‌رود. فقط وقتی عوضش کنید که سرویس‌دهندهٔ VPN شما DNS خودش را دارد (مثلاً برای حذف تبلیغ) یا این دو نشانی از داخل تونلش باز نمی‌شوند. سایت‌های ایرانی همچنان از DNS خود خط پرسیده می‌شوند.'),
		E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [
			E('label', {}, [ 'نشانی‌ها ', inDns ]),
			E('button', { 'class': 'cbi-button cbi-button-action', 'click': saveDns }, 'ذخیرهٔ DNS')
		])
	]));

	page = backup;
	page.push(sec('پشتیبان و انتقال به روتر دیگر', [
		hint('فایل پشتیبان فقط فهرست سرورهای همهٔ تونل‌ها (اسم، نشانی، درگاه و متن کانفیگ) و دو فهرست «همیشه مستقیم» و «همیشه از تونل» را دارد. نام کاربری، رمز و کلید در آن نیست و روی روتر دیگر باید خودتان دوباره واردشان کنید. سرورهای قبلی آن روتر سر جایشان می‌مانند.'),
		E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0' }, [
			E('button', { 'class': 'cbi-button cbi-button-action', 'click': doExport }, 'دانلود فایل پشتیبان')
		]),
		E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0 4px 0' }, [
			inImport,
			E('button', { 'class': 'cbi-button cbi-button-apply', 'click': doImport }, 'بازگردانی از فایل')
		]),
	]));

	return { routing: routing, backup: backup };
}

function makeView(type) {
	var T = TYPES[type];

	return view.extend({
		load: function() {
			return ex(['get', type]);
		},

		render: function(out) {
			var d = parse(out);

			var state = E('h3', { 'style': 'margin:6px 0' }, '');
			var info = E('div', { 'style': 'margin-bottom:10px;opacity:.85' }, '');
			var warnMissing = E('div', { 'class': 'alert-message warning', 'style': d.missing === '1' ? '' : 'display:none' },
				'برنامهٔ لازم برای ' + T.name + ' روی این روتر نصب نیست. نصب‌کنندهٔ vpnhub را دوباره اجرا کنید.');

			/* --- automatic switch to a backup server --- */
			var cbFail = E('input', { 'type': 'checkbox' });
			var failInfo = E('div', { 'style': 'opacity:.75;font-size:90%' }, 'روتر به همهٔ سرورهای همین نوع تونل پینگ می‌زند، پنج سروری را که کمترین پینگ را دارند به نوبت امتحان می‌کند و روی اولی که واقعاً وصل شد می‌ماند. اگر هیچ‌کدام وصل نشد، به سرور قبلی برمی‌گردد و دوباره تلاش می‌کند. ممکن است سرور تازه در کشور دیگری باشد.');
			cbFail.addEventListener('change', function() { ex(['failover', cbFail.checked ? '1' : '0']); });

			function paint(x) {
				var on = x.connected === '1';
				var other = x.active_type && x.active_type !== type;
				state.textContent = on ? 'وضعیت: وصل است' : (other ? 'وضعیت: این تونل خاموش است (تونل ' + (TYPES[x.active_type] ? TYPES[x.active_type].name : x.active_type) + ' فعال است)' : (x.enabled === '1' ? 'وضعیت: در حال تلاش برای وصل شدن (فعلاً همهٔ دستگاه‌ها روی خط مستقیم‌اند)' : 'وضعیت: خاموش (همهٔ دستگاه‌ها روی خط مستقیم‌اند)'));
				state.style.color = on ? '#2e9e4f' : (other ? '#d68910' : '#c0392b');
				info.innerHTML = '';
				if (x.server) {
					info.appendChild(E('span', {}, 'سرور انتخاب‌شده: '));
					info.appendChild(E('span', { 'dir': 'ltr' }, (x.label && x.label !== x.server ? x.label + ' — ' : '') + x.server + (x.server_ip && x.server_ip !== x.server ? ' (' + x.server_ip + ')' : '')));
				} else {
					info.appendChild(E('span', {}, 'هنوز سروری انتخاب نشده است.'));
				}
				if (on && x.vip) {
					info.appendChild(E('span', {}, ' — نشانی تونل: '));
					info.appendChild(E('span', { 'dir': 'ltr' }, x.vip));
				}
				cbFail.checked = x.failover === '1';
			}

			function refresh() {
				return ex(['get', type]).then(function(o) { if (o) paint(parse(o)); });
			}

			function busy(title, job) {
				ui.showModal(title, [ E('p', { 'class': 'spinning' }, 'لطفاً صبر کنید…') ]);
				return job().then(function(msg) {
					ui.hideModal();
					if (msg) ui.addNotification(null, E('p', {}, msg), 'info');
				}, function(e) {
					ui.hideModal();
					ui.addNotification(null, E('p', {}, 'خطا: ' + (e && e.message ? e.message : e)), 'danger');
				});
			}

			/* --- servers --- */
			var srvBody = E('tbody', {});
			var pingCells = {}, probeCells = {};
			var srvList = [], pingRes = {}, probeRes = {};
			var probeInfo = E('div', { 'style': 'margin:6px 0' }, '');
			var inSite = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'dir': 'ltr', 'style': 'width:20em;max-width:100%', 'list': 'vpnhub-sites', 'value': 'https://gemini.google.com/app' });
			var inTarget = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'dir': 'ltr', 'style': 'width:16em;max-width:100%', 'list': 'vpnhub-targets', 'value': '1.1.1.1' });
			var taAdd = E('textarea', { 'class': 'cbi-input-textarea', 'style': 'width:100%;max-width:34em;height:5em;direction:ltr;text-align:left;font-family:monospace', 'placeholder': T.bulkPlaceholder || '' });
			var inFilter = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'style': 'width:16em;max-width:100%', 'placeholder': 'جستجو: شهر یا اسم سرور' });
			inFilter.addEventListener('input', function() { renderServers(srvList); });
			var selCount = E('select', { 'class': 'cbi-input-select' }, [
				E('option', { 'value': '5' }, '5'), E('option', { 'value': '10', 'selected': 'selected' }, '10'),
				E('option', { 'value': '15' }, '15'), E('option', { 'value': '25' }, '25')
			]);
			var srvCount = E('span', { 'style': 'opacity:.75' }, '');

			function reloadAll() {
				return ex(['get', type]).then(function(o) { var x = parse(o); paint(x); renderServers(x.prof); });
			}

			function useServer(sv) {
				return busy('در حال وصل شدن به سرور', function() {
					return ex(['use', sv.id]).then(function(o) {
						if (!/server set to/.test(o)) return reloadAll().then(function() { return 'سرور عوض نشد. جواب روتر: ' + (o || 'خالی'); });
						return wait(16000).then(reloadAll).then(function() { return ''; });
					});
				});
			}

			function delServer(sv) {
				if (!window.confirm('«' + (sv.label || sv.host) + '» از فهرست حذف شود؟')) return Promise.resolve();
				return ex(['prof-del', sv.id]).then(reloadAll);
			}

			/* add / edit one server */
			function editServer(sv) {
				var isNew = !sv;
				var row = function(label, el, note) {
					return E('label', { 'style': 'display:block;margin:8px 0' }, [ E('div', {}, label), el, note ? E('div', { 'style': 'opacity:.7;font-size:90%' }, note) : '' ]);
				};
				var w = 'width:100%;max-width:30em';
				var fLabel = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'style': w });
				var fServer = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'dir': 'ltr', 'style': w, 'placeholder': 'vpn.example.com' });
				var fPort = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'dir': 'ltr', 'style': 'width:8em', 'placeholder': T.ports ? '' : '443' });
				var fRid = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'dir': 'ltr', 'style': w });
				var fProto = E('select', { 'class': 'cbi-input-select', 'dir': 'ltr' }, [ E('option', { 'value': '' }, '—'), E('option', { 'value': 'udp' }, 'UDP'), E('option', { 'value': 'tcp' }, 'TCP') ]);
				var fUser = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'dir': 'ltr', 'style': w, 'autocomplete': 'off' });
				var fPass = E('input', { 'type': 'password', 'class': 'cbi-input-password', 'dir': 'ltr', 'style': w, 'autocomplete': 'new-password' });
				var fIpsec = E('input', { 'type': 'checkbox' });
				var fPsk = E('input', { 'type': 'password', 'class': 'cbi-input-password', 'dir': 'ltr', 'style': w, 'autocomplete': 'new-password' });
				var fBody = E('textarea', { 'class': 'cbi-input-textarea', 'style': 'width:100%;max-width:38em;height:11em;direction:ltr;text-align:left;font-family:monospace;font-size:90%' });
				var fFile = E('input', { 'type': 'file' });
				fFile.addEventListener('change', function() {
					var f = fFile.files && fFile.files[0];
					if (!f) return;
					var rd = new FileReader();
					rd.onload = function() {
						fBody.value = String(rd.result || '');
						if (!fLabel.value) fLabel.value = f.name.replace(/\.(ovpn|conf)$/i, '');
					};
					rd.readAsText(f);
				});
				var pskRow = row('کلید مشترک IPsec', fPsk, isNew ? '' : 'خالی بگذارید تا همان کلید قبلی بماند.');
				function syncPsk() { pskRow.style.display = fIpsec.checked ? '' : 'none'; }
				fIpsec.addEventListener('change', syncPsk);

				var body = [];
				body.push(row('اسم دلخواه', fLabel));
				if (T.body) {
					body.push(row(T.bodyLabel, fBody, isNew ? 'متن فایل را اینجا بچسبانید یا با دکمهٔ زیر فایل را انتخاب کنید.' : 'خالی بگذارید تا همان کانفیگ قبلی بماند.'));
					body.push(E('div', { 'style': 'margin:-4px 0 8px 0' }, fFile));
				} else {
					body.push(row('نشانی سرور', fServer));
				}
				if (T.port) body.push(row('درگاه (اختیاری)', fPort, T.ports ? 'اگر خالی باشد، همان درگاهی که در متن کانفیگ (خط Endpoint) هست به کار می‌رود. اگر تست درگاه نشان داد درگاه دیگری باز است، شماره‌اش را اینجا بنویسید.' : 'اگر خالی باشد 443 به کار می‌رود.'));
				if (T.proto) body.push(row('پروتکل (اختیاری)', fProto, 'اگر انتخاب نشود، همان که در متن کانفیگ هست به کار می‌رود.'));
				if (type === 'ikev2') body.push(row('شناسهٔ سرور (اختیاری)', fRid, 'فقط وقتی لازم است که اسم روی گواهی سرور با نشانی سرور فرق داشته باشد.'));
				if (T.account) {
					body.push(row('نام کاربری' + (T.account ? ' (اختیاری)' : ''), fUser, T.account ? 'اگر خالی باشد، حساب پیش‌فرض همین صفحه به کار می‌رود.' : ''));
					body.push(row('رمز', fPass, isNew ? '' : 'خالی بگذارید تا همان رمز قبلی بماند.'));
				}
				if (type === 'l2tp') {
					body.push(E('label', { 'style': 'display:block;margin:8px 0' }, [ fIpsec, ' رمزگذاری IPsec با کلید مشترک (L2TP/IPsec)' ]));
					body.push(pskRow);
				}
				syncPsk();

				function submit() {
					var lab = fLabel.value.trim(), srv = fServer.value.trim(), u = fUser.value.trim(), p = fPass.value, k = fPsk.value, rid = fRid.value.trim();
					if (bad(lab + u + p + k + rid)) { window.alert('علامت نقل‌قول دوتایی و بک‌اسلش در اسم، نام کاربری، رمز و کلید پشتیبانی نمی‌شود.'); return; }
					if (!T.body && !srv) { window.alert('نشانی سرور را بنویسید.'); return; }
					if (T.body && isNew && !fBody.value.trim()) { window.alert('متن کانفیگ را وارد کنید.'); return; }
					var lines = [ 'id=' + (isNew ? 'new' : sv.id), 'type=' + type, 'label=' + lab ];
					if (!T.body) lines.push('server=' + srv);
					lines.push('port=' + fPort.value.trim(), 'proto=' + fProto.value, 'rid=' + rid, 'user=' + u, 'pass=' + p, 'ipsec=' + (fIpsec.checked ? '1' : '0'), 'psk=' + k, '---');
					var text = lines.join(NL) + NL + (T.body ? fBody.value : '') + NL;
					ui.hideModal();
					return busy('در حال ذخیره', function() {
						return fs.write(INFILE, text, 384).then(function() { return ex(['prof-save']); }).then(function(o) {
							return reloadAll().then(function() {
								if (/^saved /.test(o)) return /warning:/.test(o) ? 'ذخیره شد، ولی نشانی واقعی سرور الان پیدا نشد. اسم سرور را بررسی کنید.' : 'ذخیره شد.';
								var why = {
									'bad server': 'نشانی سرور درست نیست' + (T.body ? ' یا در متن کانفیگ پیدا نشد.' : '.'),
									'empty password': 'برای این نام کاربری رمز وارد نشده است.',
									'empty pre-shared key': 'کلید مشترک IPsec وارد نشده است.',
									'empty config': 'متن کانفیگ خالی است.',
									'bad characters': 'علامت نقل‌قول دوتایی یا بک‌اسلش در ورودی هست.'
								};
								return 'ذخیره نشد. ' + (why[o] || ('جواب روتر: ' + (o || 'خالی')));
							});
						});
					});
				}

				var open = function(x) {
					if (x) {
						fLabel.value = x.LABEL || ''; fServer.value = x.SERVER || ''; fRid.value = x.RID || ''; fPort.value = x.PORT || ''; fProto.value = (x.PROTO === 'tcp' || x.PROTO === 'udp') ? x.PROTO : ''; fUser.value = x.USER || '';
						fIpsec.checked = x.IPSEC === '1';
						if (x.HAS_PASS) fPass.setAttribute('placeholder', '(ذخیره شده)');
						if (x.HAS_PSK) fPsk.setAttribute('placeholder', '(ذخیره شده)');
						if (x.HAS_BODY) fBody.setAttribute('placeholder', '(کانفیگ ذخیره شده است)');
						syncPsk();
					}
					ui.showModal(isNew ? 'افزودن سرور ' + T.name : 'ویرایش «' + (sv.label || sv.host) + '»', [
						E('div', { 'dir': 'rtl', 'style': 'text-align:right' }, body.concat([
							E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px' }, [
								E('button', { 'class': 'cbi-button cbi-button-action', 'click': submit }, 'ذخیره'),
								E('button', { 'class': 'cbi-button', 'click': function() { ui.hideModal(); } }, 'انصراف')
							])
						]))
					]);
				};
				if (isNew) return open(null);
				return ex(['prof-get', sv.id]).then(function(o) {
					var x = {};
					o.split(NL).forEach(function(l) { var i = l.indexOf('='); if (i > 0) x[l.slice(0, i)] = l.slice(i + 1); });
					open(x);
				});
			}

			function cellText(c, r, failText) {
				if (!r) { c.textContent = '—'; c.style.color = ''; return; }
				if (r.site) {
					var code = +r.code || 0, sec = r.sec ? ' ' + (+r.sec).toFixed(1) + 's' : '';
					if (r.note) { c.textContent = r.note; c.style.color = '#c0392b'; }
					else if (!r.code) { c.textContent = failText; c.style.color = '#c0392b'; }
					else if (code >= 200 && code < 400) { c.textContent = 'باز شد (' + code + ')' + sec; c.style.color = '#2e9e4f'; }
					else if (code === 403 || code === 451) { c.textContent = 'رد شد (' + code + ')'; c.style.color = '#c0392b'; }
					else if (code === 0) { c.textContent = 'جواب نداد'; c.style.color = '#c0392b'; }
					else { c.textContent = 'خطا (' + code + ')'; c.style.color = '#d68910'; }
					return;
				}
				if (r.avg) {
					var ms = Math.round(+r.avg);
					c.textContent = ms + ' ms' + (+r.loss > 0 ? ' (' + r.loss + '% loss)' : '');
					c.style.color = ms < 130 ? '#2e9e4f' : (ms < 220 ? '#d68910' : '#c0392b');
				} else {
					c.textContent = r.note || failText;
					c.style.color = '#c0392b';
				}
			}

			function renderServers(list) {
				srvList = list;
				srvBody.innerHTML = '';
				pingCells = {};
				probeCells = {};
				var f = inFilter.value.trim().toLowerCase();
				var rows = list.filter(function(sv) { return !f || (sv.label + ' ' + sv.host).toLowerCase().indexOf(f) >= 0; });
				var hasPing = Object.keys(pingRes).length > 0;
				var key = function(sv) {
					if (sv.active) return -1;
					var r = pingRes[sv.id];
					return (hasPing && r && r.avg) ? +r.avg : (hasPing ? 99999 : 0);
				};
				rows = rows.map(function(sv, i) { return { sv: sv, i: i }; }).sort(function(a, b) { return (key(a.sv) - key(b.sv)) || (a.i - b.i); }).map(function(x) { return x.sv; });
				srvCount.textContent = rows.length + ' از ' + list.length + ' سرور' + (hasPing ? ' — مرتب‌شده از کمترین پینگ' : '');
				if (!rows.length) {
					srvBody.appendChild(E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td', 'colspan': '7' }, E('em', {}, list.length ? 'سروری با این جستجو پیدا نشد.' : 'هنوز سروری در فهرست نیست. با دکمهٔ «افزودن سرور» یکی بسازید.')) ]));
					return;
				}
				rows.forEach(function(sv) {
					var rb = E('input', { 'type': 'radio', 'name': 'vpnhubsrv' });
					rb.checked = sv.active;
					rb.addEventListener('change', function() { if (rb.checked) useServer(sv); });
					var pc = E('td', { 'class': 'td', 'dir': 'ltr', 'style': 'text-align:center' }, '—');
					var tc = E('td', { 'class': 'td', 'dir': 'ltr', 'style': 'text-align:center' }, '—');
					pingCells[sv.id] = pc;
					probeCells[sv.id] = tc;
					cellText(pc, pingRes[sv.id], 'no reply');
					cellText(tc, probeRes[sv.id], 'not connected');
					srvBody.appendChild(E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td', 'style': 'text-align:center' }, rb),
						E('td', { 'class': 'td' }, [ E('strong', {}, (sv.label || sv.host) + ' '), sv.label && sv.label !== sv.host ? E('span', { 'dir': 'ltr', 'style': 'opacity:.75;font-size:90%' }, sv.host) : '', (T.ports && T.account && sv.own) ? E('span', { 'style': 'opacity:.75;font-size:90%' }, ' (حساب جدا)') : '' ]),
						E('td', { 'class': 'td', 'dir': 'ltr' }, sv.ip),
						pc,
						tc,
						T.ports ? portCell(sv) : E('td', { 'class': 'td' }, !T.account ? '—' : (sv.own ? 'حساب جدا' : 'پیش‌فرض')),
						E('td', { 'class': 'td' }, [
							E('button', { 'class': 'cbi-button', 'click': function() { return editServer(sv); } }, 'ویرایش'), ' ',
							E('button', { 'class': 'cbi-button cbi-button-negative', 'click': function() { return delServer(sv); } }, 'حذف')
						])
					]));
				});
			}

			/* --- which ports answer (WireGuard / AmneziaWG) --- */
			var portRes = {};
			var portInfo = E('div', { 'style': 'margin:6px 0' }, '');
			function showPorts(o) {
				var x = {};
				o.split(NL).forEach(function(l) {
					var i = l.indexOf('=');
					if (i < 0) return;
					var k = l.slice(0, i), v = l.slice(i + 1);
					if (k === 'ports') { var p = v.split('|'); portRes[p[0]] = { open: p[1] || '', port: p[2] || '' }; } else x[k] = v;
				});
				renderServers(srvList);
				portInfo.innerHTML = '';
				if (x.ports_tried) {
					portInfo.appendChild(E('span', {}, 'درگاه‌های امتحان‌شده: درگاه خود هر سرور و '));
					portInfo.appendChild(E('span', { 'dir': 'ltr' }, x.ports_tried.split(',').join(', ')));
					if (x.ports_now && x.ports_running === '1' && portRes[x.ports_now] && portRes[x.ports_now].open === '…') portInfo.appendChild(E('span', {}, ' — نوبت: ' + ((srvList.filter(function(v) { return v.id === x.ports_now; })[0] || {}).label || '')));
					if (x.ports_running === '1') portInfo.appendChild(E('span', {}, ' — در حال تست…'));
				}
				return x;
			}
			function pollPorts() {
				return ex(['port-status']).then(function(o) {
					var x = showPorts(o);
					if (x.ports_running === '1') return wait(3000).then(pollPorts);
					return reloadAll();
				});
			}
			function portTest() {
				var n = +selCount.value;
				var go = function() {
					var ids = srvList.filter(function(sv) { return pingRes[sv.id] && pingRes[sv.id].avg; })
						.sort(function(a, b) { return +pingRes[a.id].avg - +pingRes[b.id].avg; })
						.slice(0, n).map(function(sv) { return sv.id; });
					if (!ids.length) {
						ui.addNotification(null, E('p', {}, 'هیچ سروری به پینگ جواب نداد؛ تست درگاه انجام نشد.'), 'warning');
						return;
					}
					portRes = {};
					ids.forEach(function(h) { portRes[h] = { open: '…', port: '' }; });
					renderServers(srvList);
					return ex(['port-test', type, ids.join(',')]).then(function(o) {
						if (o.indexOf('started') !== 0) {
							ui.addNotification(null, E('p', {}, o.indexOf('already') === 0 ? 'یک تست درگاه در حال اجراست. صبر کنید تمام شود.' : 'تست شروع نشد. جواب روتر: ' + (o || 'خالی')), 'warning');
							return;
						}
						return wait(2500).then(pollPorts);
					});
				};
				return Object.keys(pingRes).length ? Promise.resolve(go()) : pingAll().then(go);
			}
			function portCell(sv) {
				var nice = function(v) { return v.indexOf(':') > 0 ? v.split(':')[0].toUpperCase() + ' ' + v.split(':')[1] : v; };
				var c = E('td', { 'class': 'td' }, [ E('span', { 'dir': 'ltr' }, (T.proto && sv.proto ? sv.proto.toUpperCase() + ' ' : '') + (sv.port || '—')) ]);
				var r = portRes[sv.id];
				if (!r) return c;
				var t = '', col = '';
				if (r.open === '…') t = ' — در حال تست…';
				else if (r.open === 'active') { t = ' — همین حالا وصل است'; col = '#2e9e4f'; }
				else if (r.open === 'error') { t = ' — تست نشد'; col = '#c0392b'; }
				else if (r.open) { t = ' — باز: ' + r.open.split(',').map(nice).join('، '); col = '#2e9e4f'; }
				else { t = ' — هیچ درگاهی جواب نداد'; col = '#c0392b'; }
				if (r.port && r.open !== '…') c.firstChild.textContent = nice(r.port);
				var s = E('span', { 'style': 'display:block;font-size:90%;white-space:nowrap' }, t.replace(/^ — /, ''));
				if (col) s.style.color = col;
				c.appendChild(s);
				return c;
			}
			var inPorts = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'dir': 'ltr', 'style': 'width:18em;max-width:100%', 'value': (d.ports_list || '').split(',').join(', ') });
			function savePorts() {
				var v = inPorts.value.toLowerCase().split(/[\s,]+/).filter(function(x) { return T.proto ? /^(udp|tcp):\d+$/.test(x) : /^\d+$/.test(x); }).join(',');
				return ex(['ports-set', type, v || '-']).then(function(o) {
					var m = /^saved (.*)$/.exec(o);
					if (m) inPorts.value = m[1].split(',').join(', ');
					ui.addNotification(null, E('p', {}, /^saved/.test(o) ? 'فهرست درگاه‌ها ذخیره شد.' : 'ذخیره نشد. جواب روتر: ' + (o || 'خالی')), 'info');
				});
			}

			function pingAll() {
				Object.keys(pingCells).forEach(function(k) { pingCells[k].textContent = '…'; pingCells[k].style.color = ''; });
				return ex(['ping-all', type]).then(function(o) {
					pingRes = {};
					o.split(NL).forEach(function(l) {
						if (l.indexOf('ping=') !== 0) return;
						var p = l.slice(5).split('|');
						pingRes[p[0]] = { avg: p[1], loss: p[2] };
					});
					renderServers(srvList);
				});
			}

			function showProbe(o) {
				var x = { rows: [] };
				o.split(NL).forEach(function(l) {
					var i = l.indexOf('=');
					if (i < 0) return;
					var k = l.slice(0, i), v = l.slice(i + 1);
					if (k === 'probe') x.rows.push(v.split('|')); else x[k] = v;
				});
				var fmt = function(avg, loss) {
					if (!avg) return null;
					return Math.round(+avg) + ' ms' + (+loss > 0 ? ' (' + loss + '% loss)' : '');
				};
				var site = x.probe_mode === 'site';
				x.rows.forEach(function(r) {
					probeRes[r[0]] = site ? { site: true, code: r[1], sec: r[2], note: r[3] === 'no account' ? 'no account' : '' } : { avg: r[1], loss: r[2], note: r[3] === 'no account' ? 'no account' : '' };
					if (probeCells[r[0]]) cellText(probeCells[r[0]], probeRes[r[0]], 'not connected');
				});
				if (x.probe_now && x.probe_running === '1' && probeCells[x.probe_now] && probeCells[x.probe_now].textContent === '…') probeCells[x.probe_now].textContent = 'testing…';
				var dd = (x.probe_direct || '').split('|');
				probeInfo.innerHTML = '';
				if (x.probe_error) { probeInfo.appendChild(E('span', { 'style': 'color:#c0392b' }, 'نشانی مقصد پیدا نشد. اسم یا نشانی را بررسی کنید.')); return x; }
				if (x.probe_target && site) {
					var dc = +dd[0] || 0;
					probeInfo.appendChild(E('span', {}, 'سایت: '));
					probeInfo.appendChild(E('span', { 'dir': 'ltr' }, x.probe_target));
					probeInfo.appendChild(E('span', {}, ' — مستقیم و بدون VPN: '));
					probeInfo.appendChild(E('strong', {}, dc >= 200 && dc < 400 ? 'باز شد (' + dc + ')' : (dc === 0 ? 'جواب نداد' : 'رد شد (' + dc + ')')));
					if (x.probe_running === '1') probeInfo.appendChild(E('span', {}, ' — در حال تست…'));
				}
				else if (x.probe_target) {
					probeInfo.appendChild(E('span', {}, 'مقصد: '));
					probeInfo.appendChild(E('span', { 'dir': 'ltr' }, x.probe_target + (x.probe_ip && x.probe_ip !== x.probe_target ? ' (' + x.probe_ip + ')' : '')));
					probeInfo.appendChild(E('span', {}, ' — مستقیم و بدون VPN: '));
					probeInfo.appendChild(E('strong', { 'dir': 'ltr' }, fmt(dd[0], dd[1]) || 'no reply'));
					if (x.probe_running === '1') probeInfo.appendChild(E('span', {}, ' — در حال تست…'));
				}
				return x;
			}

			function pollProbe() {
				return ex(['probe-status']).then(function(o) {
					var x = showProbe(o);
					if (x.probe_running === '1') return wait(3000).then(pollProbe);
					return refresh();
				});
			}

			function probeAll(siteMode) {
				var t = (siteMode ? inSite : inTarget).value.trim();
				if (!t) return Promise.resolve();
				var n = +selCount.value;
				var go = function() {
					var ids = srvList.filter(function(sv) { return pingRes[sv.id] && pingRes[sv.id].avg; })
						.sort(function(a, b) { return +pingRes[a.id].avg - +pingRes[b.id].avg; })
						.slice(0, n).map(function(sv) { return sv.id; });
					if (!ids.length) {
						ui.addNotification(null, E('p', {}, 'هیچ سروری به پینگ جواب نداد؛ تست مقصد انجام نشد.'), 'warning');
						return;
					}
					if (!window.confirm('روتر به نوبت به ' + ids.length + ' سروری که کمترین پینگ را دارند وصل می‌شود و از راه هر کدام تا مقصد پینگ می‌گیرد. حدود ' + Math.max(1, Math.round(ids.length * 20 / 60)) + ' دقیقه طول می‌کشد. در این مدت همهٔ دستگاه‌ها روی خط مستقیم‌اند و در پایان تونل به حالت قبل برمی‌گردد. شروع شود؟')) return;
					probeRes = {};
					renderServers(srvList);
					ids.forEach(function(h) { if (probeCells[h]) probeCells[h].textContent = '…'; });
					return ex([siteMode ? 'site-all' : 'probe-all', type, t, ids.join(',')]).then(function(o) {
						if (o.indexOf('started') !== 0) {
							ui.addNotification(null, E('p', {}, o.indexOf('already') === 0 ? 'یک تست دیگر در حال اجراست. صبر کنید تمام شود.' : 'تست شروع نشد. اسم یا نشانی مقصد را بررسی کنید.'), 'warning');
							return;
						}
						return wait(2500).then(pollProbe);
					});
				};
				return Object.keys(pingRes).length ? Promise.resolve(go()) : pingAll().then(go);
			}

			function addBulk() {
				var text = taAdd.value.split(NL).map(function(x) { return x.trim(); }).filter(function(x) { return x; }).join(NL);
				if (!text) return Promise.resolve();
				return busy('در حال افزودن سرورها', function() {
					return fs.write(INFILE, text + NL, 384).then(function() { return ex(['bulk', type]); }).then(function(o) {
						var badList = [];
						o.split(NL).forEach(function(l) { if (l.indexOf('bad=') === 0) badList.push(l.slice(4)); });
						return reloadAll().then(function() {
							taAdd.value = badList.join(NL);
							return badList.length ? ('این‌ها اضافه نشدند، چون نشانی واقعی‌شان پیدا نشد: ' + badList.join(' ، ')) : 'اضافه شد.';
						});
					});
				});
			}

			/* --- default account --- */
			var inUser = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'dir': 'ltr', 'style': 'width:16em;max-width:100%', 'autocomplete': 'off', 'value': d.cred_user || '' });
			var inPass = E('input', { 'type': 'password', 'class': 'cbi-input-password', 'dir': 'ltr', 'style': 'width:16em;max-width:100%', 'autocomplete': 'new-password', 'placeholder': d.cred === '1' ? '(ذخیره شده)' : '' });
			function saveCred() {
				var u = inUser.value.trim(), p = inPass.value;
				if (!u || !p) {
					ui.addNotification(null, E('p', {}, 'نام کاربری و رمز هر دو باید پر باشند.'), 'warning');
					return Promise.resolve();
				}
				if (bad(u + p)) {
					ui.addNotification(null, E('p', {}, 'علامت نقل‌قول دوتایی و بک‌اسلش در نام کاربری و رمز پشتیبانی نمی‌شود.'), 'warning');
					return Promise.resolve();
				}
				return busy('در حال ذخیرهٔ حساب', function() {
					return fs.write(INFILE, u + NL + p + NL, 384)
						.then(function() { return ex(['account', type]); })
						.then(function(o) {
							inPass.value = '';
							if (/credentials saved/.test(o)) {
								inPass.setAttribute('placeholder', '(ذخیره شده)');
								return wait(/starting/.test(o) ? 16000 : 500).then(refresh).then(function() {
									return 'حساب ذخیره شد.' + (/starting/.test(o) ? ' تونل با حساب تازه دوباره وصل می‌شود؛ وضعیت را بالای صفحه ببینید.' : '');
								});
							}
							return 'حساب ذخیره نشد. جواب روتر: ' + (o || 'خالی');
						});
				});
			}

			/* --- personal WireGuard key (shared by WireGuard and AmneziaWG) --- */
			var wgKey = E('input', { 'type': 'password', 'class': 'cbi-input-password', 'dir': 'ltr', 'style': 'width:18em;max-width:100%', 'autocomplete': 'new-password', 'placeholder': d.cred === '1' ? '(ذخیره شده)' : '' });
			var wgAddr = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'dir': 'ltr', 'style': 'width:18em;max-width:100%', 'autocomplete': 'off', 'placeholder': '10.0.0.2/32', 'value': T.account ? '' : (d.cred_user || '') });
			var wgPsk = E('input', { 'type': 'password', 'class': 'cbi-input-password', 'dir': 'ltr', 'style': 'width:18em;max-width:100%', 'autocomplete': 'new-password', 'placeholder': d.cred_psk === '1' ? '(ذخیره شده)' : '' });
			function saveWgKey() {
				var k = wgKey.value.trim(), a = wgAddr.value.trim(), p = wgPsk.value.trim();
				if (!a || (!k && d.cred !== '1')) {
					ui.addNotification(null, E('p', {}, 'کلید خصوصی و نشانی تونل هر دو لازم‌اند.'), 'warning');
					return Promise.resolve();
				}
				return busy('در حال ذخیرهٔ کلید', function() {
					return fs.write(INFILE, k + NL + a + NL + p + NL, 384)
						.then(function() { return ex(['account', type]); })
						.then(function(o) {
							if (/credentials saved/.test(o)) {
								wgKey.value = ''; wgPsk.value = ''; d.cred = '1';
								wgKey.setAttribute('placeholder', '(ذخیره شده)');
								return wait(/starting/.test(o) ? 14000 : 500).then(refresh).then(function() { return 'کلید ذخیره شد.'; });
							}
							if (/bad key/.test(o)) return 'کلید درست نیست. کلید وایرگارد ۴۴ نویسه است و با علامت = تمام می‌شود.';
							if (/bad address/.test(o)) return 'نشانی تونل درست نیست. نمونه: 10.0.0.2/32';
							return 'ذخیره نشد. جواب روتر: ' + (o || 'خالی');
						});
				});
			}

			function showLog() {
				return ex(['log']).then(function(o) {
					ui.showModal('آخرین پیام‌های تونل', [
						E('pre', { 'dir': 'ltr', 'style': 'text-align:left;max-height:24em;overflow:auto;font-size:85%;white-space:pre-wrap' }, o || '(empty)'),
						E('div', { 'style': 'margin-top:10px' }, [ E('button', { 'class': 'cbi-button', 'click': function() { ui.hideModal(); } }, 'بستن') ])
					]);
				});
			}

			paint(d);
			renderServers(d.prof);
			poll.add(refresh, 5);

			var sec = function(title, children) {
				return E('div', { 'class': 'cbi-section', 'style': 'margin-top:18px' }, [ E('h3', {}, title) ].concat(children));
			};
			var hint = function(t) { return E('div', { 'style': 'opacity:.75;font-size:90%;margin:2px 0 6px 0' }, t); };

			var serverSection = [
				hint('با زدن دایرهٔ کنار هر سرور، تونل به همان سرور وصل می‌شود. «پینگ تا سرور» از خود روتر تا سرور VPN است. ستون «تست از راه سرور» نتیجهٔ آخرین تستی است که از دو دکمهٔ پایین می‌گیرید: پینگ تا یک مقصد (مثلاً سرور بازی) یا باز شدن یک سایت.'),
				E('div', { 'style': 'display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:6px 0' }, [
					E('button', { 'class': 'cbi-button cbi-button-add', 'click': function() { return editServer(null); } }, 'افزودن سرور'),
					inFilter, srvCount
				]),
				E('div', { 'style': 'overflow:auto;max-height:28em;border:1px solid rgba(128,128,128,.25);border-radius:8px' }, [
					E('table', { 'class': 'table' }, [
						E('thead', {}, [ E('tr', { 'class': 'tr table-titles' }, [
							E('th', { 'class': 'th', 'style': 'text-align:center' }, 'انتخاب'),
							E('th', { 'class': 'th' }, 'سرور'),
							E('th', { 'class': 'th' }, 'نشانی'),
							E('th', { 'class': 'th', 'style': 'text-align:center' }, 'پینگ تا سرور'),
							E('th', { 'class': 'th', 'style': 'text-align:center' }, 'تست از راه سرور'),
							E('th', { 'class': 'th' }, T.ports ? 'درگاه' : 'حساب'),
							E('th', { 'class': 'th' }, '')
						]) ]),
						srvBody
					])
				]),
				E('div', { 'style': 'margin:10px 0' }, [ E('button', { 'class': 'cbi-button cbi-button-action', 'click': function() { return pingAll(); } }, 'تست پینگ تا همهٔ سرورها') ]),
				E('datalist', { 'id': 'vpnhub-targets' }, [
					E('option', { 'value': '1.1.1.1' }, 'Cloudflare'),
					E('option', { 'value': 'youtube.com' }, 'YouTube'),
					E('option', { 'value': '155.133.226.68' }, 'CS2 Frankfurt'),
					E('option', { 'value': '155.133.252.37' }, 'CS2 Stockholm')
				]),
				E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0 4px 0' }, [
					E('label', {}, [ 'مقصد دلخواه ', inTarget ]),
					E('label', {}, [ 'تعداد سرور ', selCount ]),
					E('button', { 'class': 'cbi-button cbi-button-action', 'click': function() { return probeAll(); } }, 'تست پینگ تا مقصد از راه بهترین سرورها')
				]),
				E('datalist', { 'id': 'vpnhub-sites' }, [
					E('option', { 'value': 'https://gemini.google.com/app' }, 'Gemini'),
					E('option', { 'value': 'https://chatgpt.com/' }, 'ChatGPT'),
					E('option', { 'value': 'https://claude.ai/' }, 'Claude'),
					E('option', { 'value': 'https://www.netflix.com/' }, 'Netflix'),
					E('option', { 'value': 'https://open.spotify.com/' }, 'Spotify')
				]),
				E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0 4px 0' }, [
					E('label', {}, [ 'نشانی سایت ', inSite ]),
					E('button', { 'class': 'cbi-button cbi-button-action', 'click': function() { return probeAll(true); } }, 'تست باز شدن سایت از راه بهترین سرورها')
				]),
				hint('بعضی سایت‌ها بعضی سرورهای VPN را راه نمی‌دهند (خطای 403)، حتی وقتی کشورش مجاز است. این تست به هر سرور وصل می‌شود، همان سایت را باز می‌کند و در ستون «تست از راه سرور» می‌نویسد باز شد یا رد شد. «باز شد» یعنی خود سایت جواب داد؛ ورود به حساب را امتحان نمی‌کند.'),
				hint('مقصد می‌تواند نشانی عددی یا اسم سایت باشد. تست فقط روی سرورهایی انجام می‌شود که کمترین «پینگ تا سرور» را دارند، به تعدادی که انتخاب می‌کنید.'),
				probeInfo
			];
			if (T.ports) {
				serverSection.push(
					E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0 4px 0' }, [
						E('button', { 'class': 'cbi-button cbi-button-action', 'click': function() { return portTest(); } }, 'تست درگاه‌ها روی بهترین سرورها')
					]),
					hint(T.proto
						? '«پینگ تا سرور» فقط می‌گوید سرور روشن است؛ نمی‌گوید روی کدام پروتکل و درگاه وصل می‌شود. این تست روی سرورهایی که کمترین پینگ را دارند (به همان «تعداد سرور» بالا) با هر درگاه UDP و TCP فهرست زیر واقعاً دست می‌دهد و در ستون «درگاه» می‌نویسد کدام‌ها باز است. هر سرور حدود ۲۰ ثانیه طول می‌کشد و تونلِ در حال کار قطع نمی‌شود. اگر درگاه فعلی یک سرور بسته باشد، خودکار روی اولین درگاه باز گذاشته می‌شود. برای انتخاب دستی، «ویرایش» سرور را بزنید و پروتکل و درگاه را مشخص کنید.'
						: '«پینگ تا سرور» فقط می‌گوید سرور روشن است؛ نمی‌گوید روی کدام درگاه وصل می‌شود. این تست روی سرورهایی که کمترین پینگ را دارند (به همان «تعداد سرور» بالا) واقعاً با هر درگاه دست می‌دهد و در ستون «درگاه» می‌نویسد کدام‌ها باز است. تونلِ در حال کار قطع نمی‌شود. اگر درگاه فعلی یک سرور بسته باشد، خودکار روی اولین درگاه باز گذاشته می‌شود. هنگام وصل شدن هم اگر درگاه سرور جواب ندهد، روتر خودش بقیهٔ درگاه‌ها را امتحان می‌کند و درگاهی را که جواب داد به خاطر می‌سپارد. برای انتخاب دستی، «ویرایش» سرور را بزنید و درگاه را بنویسید.'),
					portInfo,
					E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0' }, [
						E('label', {}, [ T.proto ? 'درگاه‌هایی که امتحان می‌شوند (مثل udp:443) ' : 'درگاه‌های جایگزین که امتحان می‌شوند ', inPorts ]),
						E('button', { 'class': 'cbi-button', 'click': savePorts }, 'ذخیرهٔ درگاه‌ها')
					])
				);
			}
			if (T.bulk) {
				serverSection.push(
					E('strong', {}, 'افزودن چند سرور با هم'),
					hint('هر خط یک سرور. بعد از نشانی سرور می‌توانید یک فاصله بگذارید و اسم دلخواهی برایش بنویسید. این سرورها از حساب پیش‌فرض استفاده می‌کنند.'),
					taAdd,
					E('div', { 'style': 'margin-top:8px' }, [ E('button', { 'class': 'cbi-button cbi-button-add', 'click': addBulk }, 'افزودن به فهرست') ])
				);
			}

			var page = [
				E('h2', {}, T.title),
				E('div', { 'class': 'cbi-map-descr' }, 'هر بار فقط یک تونل روشن است: با روشن کردن این تونل، تونل‌های دیگر خاموش می‌شوند. اگر تونل قطع شود، همهٔ دستگاه‌ها خودکار به خط مستقیم برمی‌گردند و روتر خودش دوباره برای وصل شدن تلاش می‌کند.'),
				warnMissing,

				sec('وضعیت', [
					state, info,
					E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap' }, [
						E('button', { 'class': 'cbi-button cbi-button-positive', 'click': function() {
							return busy('در حال وصل شدن', function() {
								return ex(['start-bg', type]).then(function(o) {
									if (o.indexOf('starting') !== 0) return 'اول یک سرور از فهرست پایین انتخاب کنید.';
									return wait(16000).then(refresh).then(function() { return ''; });
								});
							});
						} }, 'روشن کردن'),
						E('button', { 'class': 'cbi-button cbi-button-negative', 'click': function() {
							return busy('در حال خاموش کردن', function() { return ex(['off']).then(function() { return wait(1500); }).then(refresh).then(function() { return ''; }); });
						} }, 'خاموش کردن'),
						E('button', { 'class': 'cbi-button', 'click': function() { return refresh(); } }, 'تازه‌سازی'),
						E('button', { 'class': 'cbi-button', 'click': function() { return showLog(); } }, 'پیام‌های تونل')
					]),
					E('label', { 'style': 'display:block;margin:12px 0 2px 0' }, [ cbFail, ' جایگزینی خودکار: اگر سرور فعلی حدود ۲ دقیقه وصل نشد، روتر خودش بهترین سرورِ در دسترس را پیدا کند و به آن وصل شود' ]),
					failInfo
				]),

				sec('سرورها', serverSection)
			];

			if (!T.account) {
				page.push(sec('کلید شخصی (مشترک بین WireGuard و AmneziaWG)', [
					hint('اگر متن کانفیگ یک سرور کلید خصوصی و نشانی تونل نداشته باشد (مثل سرورهایی که از فایل پشتیبان آمده‌اند)، این کلید به کار می‌رود. این سه مقدار در فایل کانفیگی که سرویس‌دهنده به شما می‌دهد هست: PrivateKey، Address و PresharedKey. کلیدهای ذخیره‌شده اینجا نمایش داده نمی‌شوند.'),
					E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [
						E('label', {}, [ 'کلید خصوصی (PrivateKey) ', wgKey ]),
						E('label', {}, [ 'نشانی تونل (Address) ', wgAddr ]),
						E('label', {}, [ 'کلید مشترک (PresharedKey، اختیاری) ', wgPsk ]),
						E('button', { 'class': 'cbi-button cbi-button-action', 'click': saveWgKey }, 'ذخیرهٔ کلید')
					])
				]));
			}

			if (T.account) {
				page.push(sec('حساب پیش‌فرض', [
					hint(T.accountHint + ' رمز ذخیره‌شده اینجا نمایش داده نمی‌شود.'),
					E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [
						E('label', {}, [ 'نام کاربری ', inUser ]),
						E('label', {}, [ 'رمز ', inPass ]),
						E('button', { 'class': 'cbi-button cbi-button-action', 'click': saveCred }, 'ذخیرهٔ حساب')
					])
				]));
			}

			page.push(E('div', { 'style': 'opacity:.75;font-size:90%;margin-top:18px' }, [
				'مسیردهی (چه چیزی از تونل برود و چه چیزی مستقیم)، چراغ روتر و پشتیبان‌گیری برای همهٔ تونل‌ها یکی است و در صفحهٔ ',
				E('a', { 'href': L.url('admin/vpnhub/settings') }, 'Settings'), ' است.'
			]));

			return E('div', { 'class': 'cbi-map', 'dir': 'rtl', 'style': 'text-align:right' }, page);
		},

		handleSave: null,
		handleSaveApply: null,
		handleReset: null
	});
}

function makeSettings() {
	return view.extend({
		load: function() {
			return Promise.all([ ex(['led-get']), ex(['settings-get']) ]);
		},

		render: function(res) {
			var out = res[0];
			var shared = sharedSections(parse(res[1]));
			var x = { leds: [] };
			(out || '').split(NL).forEach(function(l) {
				var i = l.indexOf('=');
				if (i < 0) return;
				var k = l.slice(0, i), v = l.slice(i + 1).trim();
				if (k === 'led') x.leds.push(v); else x[k] = v;
			});
			var guess = (x.led_guess || '').split('|');
			var mode = x.led_mode || 'off';

			var opt = function(val, text, cur) {
				var o = E('option', { 'value': val }, text);
				if (val === cur) o.setAttribute('selected', 'selected');
				return o;
			};
			var ledSel = function(cur) {
				return E('select', { 'class': 'cbi-input-select', 'dir': 'ltr' }, [ opt('', '—', cur) ].concat(x.leds.map(function(n) { return opt(n, n, cur); })));
			};
			var selMode = E('select', { 'class': 'cbi-input-select' }, [
				opt('off', 'خاموش (چراغ دست خود روتر بماند)', mode),
				opt('rgb', 'چراغ سه‌رنگ (قرمز، سبز، آبی)', mode),
				opt('single', 'یک چراغ ساده', mode)
			]);
			var sR = ledSel(x.led_r || guess[0] || ''), sG = ledSel(x.led_g || guess[1] || ''), sB = ledSel(x.led_b || guess[2] || '');
			var sOne = ledSel(x.led_one || '');
			var li = function(a, b) { return E('li', {}, [ E('strong', {}, a), ' — ' + b ]); };
			var boxRgb = E('div', {}, [
				E('div', { 'style': 'display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:8px 0' }, [
					E('label', {}, [ 'چراغ قرمز ', sR ]), E('label', {}, [ 'چراغ سبز ', sG ]), E('label', {}, [ 'چراغ آبی ', sB ])
				]),
				E('ul', { 'style': 'margin:6px 18px' }, [
					li('بنفش ثابت', 'تونل وصل است و خروجی در قارهٔ آمریکاست'),
					li('آبی ثابت', 'تونل وصل است و خروجی جای دیگری است (اروپا، آسیا و …)'),
					li('قرمز ثابت', 'اینترنت هست ولی مستقیم (بدون تونل)'),
					li('سبز چشمک‌زن', 'از مودم اینترنت نمی‌آید'),
					li('زرد چشمک‌زن', 'نیاز به سر زدن به پنل: تونل باید وصل باشد ولی ۳ دقیقه است وصل نشده، یا اسم سایت‌ها پیدا نمی‌شود')
				])
			]);
			var boxOne = E('div', {}, [
				E('div', { 'style': 'margin:8px 0' }, [ E('label', {}, [ 'کدام چراغ ', sOne ]) ]),
				E('ul', { 'style': 'margin:6px 18px' }, [
					li('روشن ثابت', 'تونل وصل است'),
					li('خاموش', 'اینترنت مستقیم است (بدون تونل)'),
					li('چشمک تند', 'از مودم اینترنت نمی‌آید'),
					li('چشمک کند', 'نیاز به سر زدن به پنل')
				])
			]);
			function sync() {
				boxRgb.style.display = selMode.value === 'rgb' ? '' : 'none';
				boxOne.style.display = selMode.value === 'single' ? '' : 'none';
			}
			selMode.addEventListener('change', sync);
			sync();

			function note(t, kind) { ui.addNotification(null, E('p', {}, t), kind || 'info'); }
			function save() {
				var m = selMode.value;
				if (m === 'rgb' && (!sR.value || !sG.value || !sB.value)) { note('هر سه چراغ قرمز، سبز و آبی را انتخاب کنید.', 'warning'); return Promise.resolve(); }
				if (m === 'single' && !sOne.value) { note('یک چراغ را انتخاب کنید.', 'warning'); return Promise.resolve(); }
				return ex(['led-set', m, sR.value || '-', sG.value || '-', sB.value || '-', sOne.value || '-']).then(function(o) {
					note(/^saved/.test(o) ? (m === 'off' ? 'ذخیره شد. چراغ به کنترل خود روتر برگشت.' : 'ذخیره شد. چراغ تا چند ثانیهٔ دیگر وضعیت فعلی را نشان می‌دهد.') : 'ذخیره نشد. جواب روتر: ' + (o || 'خالی'));
				});
			}
			function test() {
				return ex(['led-test']).then(function(o) {
					note(/^started/.test(o) ? 'حدود ۱۵ ثانیه به چراغ نگاه کنید: هر حالت ۳ ثانیه نشان داده می‌شود (مستقیم، تونل، تونل آمریکا، بدون اینترنت، نیاز به سر زدن) و بعد به حالت عادی برمی‌گردد.' : 'اول چراغ را روشن و ذخیره کنید.');
				});
			}

			var body = x.leds.length ? [
				E('div', { 'style': 'margin:6px 0' }, [ E('label', {}, [ 'حالت ', selMode ]) ]),
				boxRgb, boxOne,
				E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' }, [
					E('button', { 'class': 'cbi-button cbi-button-save', 'click': save }, 'ذخیره'),
					E('button', { 'class': 'cbi-button', 'click': test }, 'آزمایش چراغ')
				])
			] : [ E('em', {}, 'این روتر چراغ قابل کنترلی ندارد.') ];

			return E('div', { 'class': 'cbi-map', 'dir': 'rtl', 'style': 'text-align:right' }, [
				E('h2', {}, 'تنظیمات VPNHUB'),
				E('div', { 'class': 'cbi-map-descr' }, 'این تنظیم‌ها برای همهٔ تونل‌ها یکی است.')
			].concat(shared.routing, [
				E('div', { 'class': 'cbi-section', 'style': 'margin-top:18px' }, [
					E('h3', {}, 'چراغ وضعیت'),
					E('div', { 'style': 'opacity:.75;font-size:90%;margin:2px 0 6px 0' }, 'اختیاری است. اگر روشنش کنید، چراغ روتر نشان می‌دهد اینترنت خانه الان از تونل می‌رود، مستقیم است یا قطع شده. اسم چراغ‌ها در هر روتر فرق دارد؛ با «آزمایش چراغ» مطمئن شوید درست انتخاب کرده‌اید. با انتخاب «خاموش» چراغ به حالت قبلی خودش برمی‌گردد.')
				].concat(body))
			], shared.backup));
		},

		handleSave: null,
		handleSaveApply: null,
		handleReset: null
	});
}

return baseclass.extend({
	view: function(type) {
		return makeView(type);
	},
	settings: function() {
		return makeSettings();
	}
});
