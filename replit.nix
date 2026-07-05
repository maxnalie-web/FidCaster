{pkgs}: {
  deps = [
    pkgs.chromium
    pkgs.alsa-lib
    pkgs.pango
    pkgs.cairo
    pkgs.gtk3
    pkgs.freetype
    pkgs.fontconfig
    pkgs.expat
    pkgs.cups
    pkgs.at-spi2-atk
    pkgs.libxkbcommon
    pkgs.xorg.libxcb
    pkgs.xorg.libXtst
    pkgs.xorg.libXrender
    pkgs.xorg.libXrandr
    pkgs.xorg.libXi
    pkgs.xorg.libXext
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcursor
    pkgs.xorg.libX11
    pkgs.dbus
    pkgs.nspr
    pkgs.nss
    pkgs.glib
  ];
}
