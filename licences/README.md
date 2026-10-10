# Licence texts shipped with Talkie

Copied in by hand because no package on disk carries them, and shipped beside the app — every
file here is installed at `Talkie.app/Contents/Resources/licences/`, outside the app archive,
where a person can open it. The Licences screen in Settings shows the same texts.

| File | Why it is here |
|---|---|
| `GPL-2.0.txt` | FFmpeg, x264 and x265 inside Remotion's compositor are GPL-2.0-or-later. The GPL asks for a copy of itself to travel with the binary. |
| `GPL-3.0.txt` | eSpeak NG, compiled into `phonemizer` for the Kokoro voice, is GPL-3.0-or-later. Also the version a distributor should elect for FFmpeg — see NOTICE. |
| `onnxruntime/LICENSE` | ONNX Runtime 1.21.0 is MIT, and its npm package ships no licence file — MIT's one condition is that this notice goes with every copy. From the `v1.21.0` tag of microsoft/onnxruntime. |
| `onnxruntime/ThirdPartyNotices.txt` | The components compiled into ONNX Runtime's native library — Eigen (MPL-2.0), protobuf, abseil and others — and their terms. Same tag. |

Update the ONNX Runtime files whenever `onnxruntime-node` changes version: they describe that
build and no other. `licences.test.ts` checks the version they are for still matches.
