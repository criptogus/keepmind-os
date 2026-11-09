# Official KeepMind logo source

Repository: https://github.com/criptogus/keepmind (MIT, KeepMind contributors).
Commit: a47e9d66982f9106fe8aa3f10eed24af90f61588, dated 2026-11-08,
“rebrand to KeepMind … New logo: circuit-K in a hex chip”.

Upstream files `build/icon.png` (1024×1024 RGBA), `build/icon.icns`, and
`build/icon.ico` (16–256px) were generated there by `scripts/make-icon.mjs`.
The owner copied those three files unchanged to the same paths in this repo.
The official artwork was not redrawn.

The owner produced `build/icons/{16,24,32,48,64,128,256,512,1024}x{same}.png`
(the Linux icon set) by LANCZOS downscaling the upstream PNG, and generated
`assets/brand/keepmind-mark-64.png` and `assets/brand/keepmind-mark-128.png`
for in-app use from that artwork. The in-app assets are imported through Vite.
