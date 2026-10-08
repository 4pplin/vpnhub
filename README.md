# vpnhub

<div dir="rtl">

یک سربرگ **VPNHUB** برای پنل روترهای OpenWrt. روتر خودش به سرور VPN وصل می‌شود و همهٔ دستگاه‌های خانه بدون نصب هیچ برنامه‌ای از تونل استفاده می‌کنند.

شش نوع تونل را پشتیبانی می‌کند:<br>
IKEv2، L2TP (IPsec or Simple)، OpenVPN، WireGuard، AmneziaWG و SSTP.

## امکانات

- **سرورها:** هر تونل صفحهٔ خودش را دارد، با فهرست سرورها و وصل شدن با یک کلیک. هر بار فقط یک تونل روشن است.
- **مسیردهی:** سایت‌های ایرانی مستقیم می‌روند و بقیه از تونل. فهرست «همیشه مستقیم» و «همیشه از تونل» و انتخاب دستگاه‌ها هم دارد. فهرست ایران با یک دکمه به‌روز می‌شود.
- **تست‌ها:** پینگ تا هر سرور، پینگ تا یک مقصد دلخواه از راه هر سرور، تست این‌که یک سایت (مثلاً Gemini) از راه کدام سرورها باز می‌شود، و تست این‌که هر سرور روی کدام درگاه‌ها واقعاً جواب می‌دهد (OpenVPN، WireGuard و AmneziaWG).
- **پایداری:** اگر تونل قطع شود، دستگاه‌ها به خط مستقیم برمی‌گردند و روتر دوباره وصل می‌شود. با یک تیک، اگر سرور برنگشت، خودش بهترین سرورِ در دسترس را پیدا می‌کند.
- **پشتیبان:** فهرست سرورها را در یک فایل می‌گیرید و روی روتر دیگر بازگردانی می‌کنید. نام کاربری، رمز و کلید در این فایل نیست.
- **چراغ وضعیت (اختیاری):** چراغ روتر نشان می‌دهد اینترنت از تونل می‌رود، مستقیم است یا قطع شده.

## پیش‌نیاز

OpenWrt نسخهٔ 22.03 یا جدیدتر با پنل LuCI، و چند مگابایت جای خالی.

## نصب

با SSH به روتر وصل شوید و این خط را بزنید:

```sh
wget -O /tmp/vpnhub-install.sh https://raw.githubusercontent.com/4pplin/vpnhub/main/install.sh && sh /tmp/vpnhub-install.sh
```

اگر نشانی بالا باز نشد:

```sh
wget -O /tmp/vpnhub-install.sh https://cdn.jsdelivr.net/gh/4pplin/vpnhub@main/install.sh && sh /tmp/vpnhub-install.sh
```

بعد یک بار از پنل خارج و دوباره وارد شوید. سربرگ **VPNHUB** شش صفحهٔ تونل و در آخر صفحهٔ Settings دارد.

نصب‌کننده چه چیزهایی را روی روتر عوض می‌کند:

- برنامه‌های لازم را نصب می‌کند (strongSwan، OpenVPN، WireGuard، xl2tpd، sstp-client). اگر سایت رسمی OpenWrt باز نشود، از نسخهٔ آینه‌ای می‌گیرد.
- اگر لازم باشد `dnsmasq` را با `dnsmasq-full` عوض می‌کند.
- **AmneziaWG در مخزن رسمی OpenWrt نیست؛** ماژول آماده‌اش از پروژهٔ جدای [awg-openwrt](https://github.com/Slava-Shchipunov/awg-openwrt) گرفته می‌شود.
- سه رابط شبکه، یک ناحیهٔ دیوار آتش به اسم `vpnhub` و یک بررسی‌کنندهٔ هر‌دقیقه‌ای می‌سازد.

گزینه‌ها: `--no-packages` (هیچ برنامه‌ای نصب نشود)، `--keep-dnsmasq`، `--no-amneziawg`.

## حذف

```sh
wget -O /tmp/vpnhub-uninstall.sh https://raw.githubusercontent.com/4pplin/vpnhub/main/uninstall.sh && sh /tmp/vpnhub-uninstall.sh
```

سرورها و تنظیم‌ها در `/etc/vpnhub` می‌مانند؛ با `--purge` آن‌ها هم پاک می‌شوند. برنامه‌های سیستمی دست‌نخورده می‌مانند.

## خط فرمان

```sh
vpnhub status
vpnhub on ikev2
vpnhub off
vpnhub log
```

## محدودیت‌ها

- فقط روی OpenWrt 25.12 آزمایش شده است. IKEv2، OpenVPN، WireGuard و AmneziaWG با سرور واقعی وصل شده‌اند؛ L2TP و SSTP نه. نصب روی نسخه‌های قدیمی‌تر (با `opkg`) آزمایش نشده است.
- رمزها و کلیدها روی خود روتر در `/etc/vpnhub` نگه داشته می‌شوند و هر کس دسترسی مدیر روتر را داشته باشد می‌تواند آن‌ها را ببیند.
- IKEv2 و L2TP/IPsec سرویس strongSwan روتر را خودشان روشن و خاموش می‌کنند.
- فقط IPv4 از تونل می‌رود.
- SSTP گواهی سرور را سخت‌گیرانه بررسی نمی‌کند.

## مجوز

MIT

</div>

---

**English:** a LuCI tab for OpenWrt (22.03+) that manages IKEv2, L2TP(/IPsec), OpenVPN, WireGuard, AmneziaWG and SSTP *client* tunnels: server lists, split routing with Iranian destinations direct, ping and port tests, automatic reconnect and failover. The interface is in Persian. Install with the one-liner above.
