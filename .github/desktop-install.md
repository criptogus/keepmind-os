<!-- install -->
## Installing

KeepMind OS is a pre-release of the new base. Automatic updates are disabled.

**macOS (easiest)**: paste this in Terminal. It downloads the app, checks its SHA-256, puts it in Applications and opens it, with no Gatekeeper prompt:

```sh
curl -fsSL https://raw.githubusercontent.com/criptogus/keepmind-os/main/scripts/install-mac.sh | sh
```

**macOS (manual)**: open the DMG and drag KeepMind OS to Applications. This build is ad-hoc signed, not notarized. If macOS blocks the first launch, use System Settings → Privacy & Security → Open Anyway after trying to open it.

**Windows**: choose the x64 or ARM64 installer for your computer. This installer has no publisher certificate; Windows may show SmartScreen.

**Linux**: install the .deb for your architecture, or make the AppImage executable and open it.

SHA-256 checksums accompany each installer. Existing legacy data is not automatically migrated. Connect to your KeepMind server or start a local server from the app.
