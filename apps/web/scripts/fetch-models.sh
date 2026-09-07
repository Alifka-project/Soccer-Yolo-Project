#!/bin/bash
# Downloads the detector weights into public/models so the dashboard does not
# depend on a CDN request at load time. Run once after cloning.
set -e
cd "$(dirname "$0")/.."
BASE=https://storage.googleapis.com/tfjs-models/savedmodel
for M in ssdlite_mobilenet_v2 ssd_mobilenet_v2; do
  mkdir -p "public/models/$M"
  curl -fsS --max-time 120 -o "public/models/$M/model.json" "$BASE/$M/model.json"
  SHARDS=$(node -e "const m=require('./public/models/$M/model.json');const p=[];(m.weightsManifest||[]).forEach(g=>(g.paths||[]).forEach(x=>p.push(x)));console.log(p.join(' '))")
  for S in $SHARDS; do curl -fsS --max-time 180 -o "public/models/$M/$S" "$BASE/$M/$S"; done
  echo "$M: $(ls "public/models/$M" | wc -l | tr -d ' ') files"
done
