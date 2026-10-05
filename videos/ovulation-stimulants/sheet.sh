#!/bin/sh
# sheet.sh out.png a.png b.png ... -> horizontal strip at 360x640 each
o=$1; shift; n=$#; args=""; f=""
i=0; for x in "$@"; do args="$args -i $x"; f="$f[$i:v]scale=405:720[v$i];"; i=$((i+1)); done
s=""; i=0; while [ $i -lt $n ]; do s="$s[v$i]"; i=$((i+1)); done
ffmpeg -y -loglevel error $args -filter_complex "$f${s}hstack=inputs=$n" $o
