#!/bin/bash
# Posodobitev Line iz programa (lastnik 23. 11. 2026: »Ne prenosnika to more biti del programa«). V paketu je kot
# /opt/Lina/resources/lina/posodobi.sh; zazene jo streznik Line (posodobitev.server.ts) kot LOCEN proces (setsid),
# ker zapre Lino in s tem tudi streznik.
# Raba: posodobi.sh [--preveri] <pot do .deb> <podatkovna mapa Line> <sha256 preverjene datoteke> [<paket>]
# <paket> (25. 11. 2026): s seznama dovoljenih (lina-lupina, safeer-os); brez njega lina-lupina. Za safeer-os Lina ostane odprta
# in Safeer OS ne dobi nobenega signala: novo razlicico zazene sam (nova_razlicica, koda 75).
# --preveri: samo izpise na stdout, kaj bi naredil (brez obvestila, dnevnika, zapiranja Line in pkexec).
# Nikoli ne namesti starejse ali enake razlicice (23. 11. 2026 je bil pomotoma namescen 0.2.5 cez 0.2.8).
set -u
PATH=/usr/bin:/bin
# Streznik Line tece v nacinu Node; podedovano bi lina-lupina zagnalo Node namesto programa.
unset ELECTRON_RUN_AS_NODE LINA_LUPINA_ZETON
PREVERI=0
if [ "${1:-}" = "--preveri" ]; then PREVERI=1; shift; fi
[ $# -eq 3 ] || [ $# -eq 4 ] || { echo "raba: $0 [--preveri] <deb> <mapa> <sha256> [<paket>]" >&2; exit 2; }
DEB=$1; MAPA=$2; SHA=$3; PRICAKOVAN=${4:-lina-lupina}
case "$PRICAKOVAN" in
  lina-lupina) PROGRAM=Lina; IZID=posodobitev-izid.json ;;
  safeer-os) PROGRAM="Safeer OS"; IZID=posodobitev-izid-safeer-os.json ;;
  *) echo "paket ni na seznamu dovoljenih" >&2; exit 2 ;;
esac

for a in "$DEB" "$MAPA"; do
  case "$a" in /*) ;; *) echo "pot ni absolutna" >&2; exit 2 ;; esac
  case "$a" in *[[:cntrl:]]*) echo "pot ima nadzorne znake" >&2; exit 2 ;; esac
done
[[ "$SHA" =~ ^[0-9a-f]{64}$ ]] || { echo "neveljavna vsota" >&2; exit 2; }
[ -d "$MAPA" ] || { echo "podatkovne mape ni" >&2; exit 2; }

DNEVNIK="$MAPA/posodobitev.log"
NOVA=""
sporoci() {
  [ $PREVERI = 1 ] && { echo "$1"; return; }
  notify-send -a Lina "Posodobitev: $PROGRAM" "$1" 2>/dev/null
  echo "$(date '+%F %T') $1" >> "$DNEVNIK"
}
# Izid s fiksnimi polji (razlicica je samo stevke in pike, koda je s seznama), atomarno prek zacasne datoteke.
izid() {
  [ $PREVERI = 1 ] && return
  local r=$NOVA
  [[ "$r" =~ ^[0-9]+(\.[0-9]+)*$ ]] || r=0
  printf '{"cas":"%s","razlicica":"%s","ok":%s,"koda":"%s"}\n' "$(date -u +%FT%TZ)" "$r" "$1" "$2" > "$MAPA/.posodobitev-izid.tmp" \
    && mv -f "$MAPA/.posodobitev-izid.tmp" "$MAPA/$IZID"
}

if [ $PREVERI = 0 ]; then
  # Ena posodobitev naenkrat tudi med procesi (streznik ima svoj zaklep, ta velja, ce bi skripto zagnal se kdo).
  exec 9>"$MAPA/posodobitev.lock" || exit 1
  flock -n 9 || { sporoci "Posodobitev ze tece."; exit 1; }
fi

[ -f "$DEB" ] || { sporoci "Paketa ni: $DEB"; izid false napaka; exit 1; }
PAKET=$(/usr/bin/dpkg-deb -f "$DEB" Package 2>/dev/null)
NOVA=$(/usr/bin/dpkg-deb -f "$DEB" Version 2>/dev/null)
[ "$PAKET" = "$PRICAKOVAN" ] || { sporoci "Datoteka ni paket $PRICAKOVAN."; NOVA=""; izid false napacen_paket; exit 1; }
[[ "$NOVA" =~ ^[0-9]+(\.[0-9]+)*$ ]] || { sporoci "Razlicica paketa ni veljavna."; NOVA=""; izid false napacen_paket; exit 1; }
VSOTA=$(sha256sum "$DEB" | cut -d' ' -f1)
[ "$VSOTA" = "$SHA" ] || { sporoci "Vsota paketa se ne ujema s preverjeno; nic ne namescam."; izid false vsota; exit 1; }
ZDAJ=$(/usr/bin/dpkg-query -W -f='${Version}' "$PAKET" 2>/dev/null) || ZDAJ=ni
[ -n "$ZDAJ" ] || ZDAJ=ni
if [ "$ZDAJ" = "ni" ] || ! /usr/bin/dpkg --compare-versions "$NOVA" gt "$ZDAJ"; then
  sporoci "Paket $NOVA ni novejsi od namescene $ZDAJ; nic ne namescam."; izid false ni_novejsa; exit 1
fi
if [ $PREVERI = 1 ]; then echo "paket: $PAKET | namesceno: $ZDAJ | nova: $NOVA | $DEB | ukaz: /usr/bin/pkexec /usr/bin/dpkg -i"; exit 0; fi

sporoci "Namescam $PROGRAM $NOVA (zdaj $ZDAJ). Vpisite geslo v oknu."
if [ "$PAKET" = "safeer-os" ]; then
  # Brez zapiranja Line in brez signalov Safeer OS (skil safeer-os-ponovni-zagon-link).
  /usr/bin/pkexec /usr/bin/dpkg -i "$DEB" >> "$DNEVNIK" 2>&1 9>&-
  KODA=$?
  ZDAJ2=$(/usr/bin/dpkg-query -W -f='${Version}' safeer-os 2>/dev/null)
  if [ $KODA = 0 ] && [ "$ZDAJ2" = "$NOVA" ]; then
    sporoci "Safeer OS $NOVA je namescen. Nova razlicica se zazene sama."; izid true namesceno; exit 0
  elif [ $KODA = 126 ] || [ $KODA = 127 ]; then
    sporoci "Posodobitev je preklicana (geslo ni bilo vpisano)."; izid false preklicano; exit 1
  else
    sporoci "Namestitev ni uspela (ostaja $ZDAJ2). Podrobnosti: $DNEVNIK"; izid false napaka; exit 1
  fi
fi
# Cisto zaprtje (od 0.2.7). Ne pkill: ubil bi tudi procese Chromiuma in Lina bi se sesula.
/opt/Lina/lina-lupina --koncaj >/dev/null 2>&1 < /dev/null 9>&-
# Zeton za --koncaj velja samo za to Lino; nova (setsid spodaj) ga ne sme podedovati.
unset LINA_KONCAJ_ZETON
for i in $(seq 1 15); do pgrep -x lina-lupina >/dev/null || break; sleep 1; done
# Starejsa Lina brez --koncaj: SIGTERM samo glavnemu procesu (brez --type in brez streznika).
for p in $(pgrep -x lina-lupina); do
  a=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null)
  case "$a" in *--type=*|*index.mjs*) ;; *) kill -TERM "$p" 2>/dev/null ;; esac
done
for i in $(seq 1 10); do pgrep -x lina-lupina >/dev/null || break; sleep 1; done
/usr/bin/pkexec /usr/bin/dpkg -i "$DEB" >> "$DNEVNIK" 2>&1
KODA=$?
# Lina se odpre znova vedno, tudi ob preklicanem geslu.
# 9>&-: nova Lina ne sme podedovati zaklepa, sicer bi naslednja posodobitev dobila »ze tece«.
setsid /opt/Lina/lina-lupina >/dev/null 2>&1 < /dev/null 9>&- &
ZDAJ2=$(/usr/bin/dpkg-query -W -f='${Version}' lina-lupina 2>/dev/null)
if [ $KODA = 0 ] && [ "$ZDAJ2" = "$NOVA" ]; then
  sporoci "Lina $NOVA je namescena in zagnana."; izid true namesceno
elif [ $KODA = 126 ] || [ $KODA = 127 ]; then
  # pkexec: 126 = uporabnik je zavrnil ali zaprl okno za geslo, 127 = ni pooblastila.
  sporoci "Posodobitev je preklicana (geslo ni bilo vpisano)."; izid false preklicano; exit 1
else
  sporoci "Namestitev ni uspela (ostaja $ZDAJ2). Podrobnosti: $DNEVNIK"; izid false napaka; exit 1
fi
