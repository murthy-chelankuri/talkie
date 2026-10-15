# Three files of the Kokoro voice, for tests

`config.json`, `tokenizer.json` and `tokenizer_config.json` are copied unchanged from
[onnx-community/Kokoro-82M-v1.0-ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) at
revision `1939ad2a8e416c0acfeecc08a694d14ef25f2231`, the ONNX conversion of
[hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M). Both are licensed under the Apache
License, Version 2.0, a copy of which is in this repository's [LICENSE](../../../../../../LICENSE).

They are the real files, not stand-ins, so `kokoroDownload.test.ts` checks them against the size and
SHA-256 pinned in `KOKORO_FILES`. The 163 MB weights are not here: the tests leave them out, and the
app downloads them on first use.
