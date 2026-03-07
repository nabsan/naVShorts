# Shorts/Reels Maker (Windows)

YouTube Shorts / Instagram Reels向けの**9:16縦動画**を作るWindowsデスクトップアプリです。  
技術スタックは **Tauri + Rust + FFmpeg** です。

## スクリーンショット付きガイド
![メイン画面](docs/screenshots/01_main_ui.png)

## このアプリでできること
- ローカル動画を1本読み込み
- 9:16へ自動フィット/クロップ
- エフェクト追加（Zoom + Beat Bounce）
- 音声からビート解析
- MP4（H.264 + AAC）で書き出し
- CPU/GPUエンコード対応（CPU/NVIDIA/Intel/AMD）
- 進捗バーとETA（残り予測時間）表示
- 書き出し実行ログをJSON（既定）で出力

## 現在の仕様（v1）
- 1クリップ編集のみ
- 出力サイズ:
  - 本番プリセット: `1080x1920` と `2160x3840 (縦4K)`
  - プレビュー: `540x960`
- プリセット:
  - `YouTube Shorts (1080x1920)`
  - `Instagram Reels (1080x1920)`
  - `Vertical 4K (2160x3840)`
- エンコーダー選択:
  - `Auto`（推奨、利用可能なGPUを自動選択）
  - `CPU`
  - `NVIDIA (NVENC)` / `Intel (QSV)` / `AMD (AMF)`（環境依存）
- 入力動画の選択拡張子: `mp4, mov, mkv, avi, webm`
- 出力初期ファイル名:
  - 入力と同じフォルダ
  - `<元名>_exported_yymmddhhmmss.<拡張子>`
  - 例: `hoge.mp4` -> `hoge_exported_260307154512.mp4`
- 書き出しログ:
  - 既定: `<出力ファイル名>.json`
  - 任意: `.log`
  - プリセット/エフェクト/エンコーダー/ffmpegコマンド/所要時間/ステータス/stderr を保存

## Zoom mode の違い
- `None`: ズーム効果なし
- `Zoom In`: 時間経過で徐々に寄る
- `Zoom Out`: 時間経過で徐々に引く
- `Zoom In & Out (Beat Sync)`: 検出ビートごとに寄り/引きを交互に切替
  - `Analyze Beats` 後の利用を推奨
- `Zoom In & Out (Loop)`: 時間ベースで寄り/引きを周期ループ
  - ビート解析なしでも動作

## スライダーを増減するとどうなるか
すべて `0.00 ~ 1.00`。

### Zoom strength
- 上げる: ズームが強くなる。
- 下げる: ズームが穏やかになり安定する。

### Bounce strength
- 上げる: ビート時の跳ねが大きくなる。
- 下げる: 揺れが小さくなり落ち着く。

### Beat sensitivity
- 上げる: ビート検出点が増える。
- 下げる: 強いピーク中心の検出になる。

![スライダー](docs/screenshots/04_effects_sliders.png)

## 初心者向け Step by Step
1. アプリ起動
2. `Verify FFmpeg` を押す
3. `Select & Open Video` を押して動画を選ぶ
4. 自動入力された `Output path` を確認
5. `Zoom mode` とスライダーを調整
6. `Apply Effects` を押す
7. `Zoom In & Out (Beat Sync)` を選んだ場合は `Analyze Beats` を押す
8. （任意）`Render Preview`
9. `Preset` と `Encoder` を選ぶ
10. `Export Final`
11. 完了後、同じフォルダに出る `.json` ログを確認
12. 進捗バーとETAを見ながら完了待ち

![動画選択ダイアログ](docs/screenshots/02_open_video_dialog.png)
![動画読み込み後](docs/screenshots/03_after_open_project_status.png)
![ビート解析後](docs/screenshots/05_analyze_beats_done.png)
![プレビュー進捗](docs/screenshots/06_preview_render_progress.png)
![書き出し完了](docs/screenshots/07_export_done.png)

## ボタン説明
- `Select & Open Video`: ファイル選択して読み込む
- `Verify FFmpeg`: ffmpeg / ffprobe確認
- `Apply Effects`: 設定反映
- `Analyze Beats`: ビート解析
- `Render Preview`: 低解像度確認
- `Export Final`: 選択したプリセット/エンコーダーで本番書き出し

右パネル:
- 上: `Status`（進捗/ETA）
- 下: `Project` JSON

## 最近の変更点（2026-03-07）
- `Vertical 4K (2160x3840)` プリセット追加
- GPU加速エンコード選択（NVENC/QSV/AMF + 自動フォールバック）追加
- 出力ファイル横に実行ログを書き出し（既定 `.json`）
- ズーム表現を追加（ビート同期の交互ズーム / 時間ループの交互ズーム）
- `Select & Open Video` の不具合と移動後のビルド安定性を修正

## 開発起動
```powershell
npm install
npm.cmd run tauri dev
```

## 補足
- スクショ命名ルール: `docs/screenshots/README.md`
- v1はシンプルな1クリップフロー重視です。
