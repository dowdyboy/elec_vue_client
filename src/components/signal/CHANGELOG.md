# Changelog

All notable changes to `elec-signal-charts` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.5.0] - 2026-11-18

Minor version: adds the optional `powerUnit` prop and the `viewportChange` event;
all other changes are backward-compatible fixes.

### Added

- `SignalQualityPanel`: new `powerUnit` prop (default `dBm`) so hosts can label the
  power / peak-power rows as `dBFS` or any other unit.
- `SpectrogramChart`: new `viewportChange` event (`{ startBin, endBin, fullSpan }`),
  emitted together with `frequencyChange` on reset, zoom, pan and pinch gestures.

### Fixed

- APD/CCDF: `meanDb` is now averaged in the power domain
  (`10 * log10(mean(10 ** (v / 10)))`). The previous dB-domain arithmetic mean
  underestimated the mean level (Jensen's inequality) and overstated PAPR.
- Spectrogram: frame `fftSize` metadata now takes precedence over the row-width
  derived value, so decimated backend rows keep a correct `timeStepSec` and
  frequency axis; a metadata/row-width mismatch only warns once in dev.
- Keyboard: shortcuts now use a shared arbiter across chart instances — only the
  most recently hovered/focused chart responds (IQ/spectrum/spectrogram), and
  held (`repeat`) keys are ignored.
- Spectrogram Canvas2D fallback: the rightmost frequency column is no longer
  dropped (`freqEnd` is inclusive, matching the WebGL shader).
- IQ trigger: `findEdge` can compare the previous segment's last sample, so an
  edge exactly on a frame boundary is detected; the cached sample is reset on
  `clear()`.
- PNG export: IQ/spectrum exports no longer advance persistence fade-out or clear
  the pending snapshot — canvas state and pixels are preserved around the export
  render.
- Eye diagram CSV export: `URL.revokeObjectURL` is deferred by 1000 ms so browsers
  do not cancel the download while the Blob is still being read.
- Constellation analysis: the resolved analysis config is cached instead of being
  re-serialized every frame, and an invalid-config error is reported once per
  config change (deep watch avoids rebuilding the analyzer for equivalent objects).

## Notes

Earlier changes are not tracked in this file.
