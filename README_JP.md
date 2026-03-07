# Shorts/Reels Maker (Windows)

YouTube Shorts / Instagram Reels向けの**9:16縦動画**を作るWindowsデスクトップアプリです。  
技術スタックは **Tauri + Rust + FFmpeg** です。

## このアプリでできること
- ローカル動画を1本読み込み
- 9:16へ自動フィット/クロップ
- エフェクト追加（Zoom + Beat Bounce）
- 音声からビート解析
- MP4（H.264 + AAC）で書き出し
- CPU/GPUエンコード対応（CPU/NVIDIA/Intel/AMD）
- 進捗バーとETA（残り予測時間）表示
- 出力動画の横に実行ログ（JSON）を書き出し
- 出力動画の横にFFmpegフィルタースクリプト（debug用）を保存

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
- 出力時に作成されるファイル:
  - ログ: `<出力ファイル名>.json`
  - フィルタースクリプト: `<出力ファイル名>.filter_script.txt`

## Zoom mode の違い
- `None`: ズーム効果なし
- `Zoom In`: 時間経過で徐々に寄る
- `Zoom Out`: 時間経過で徐々に引く
- `Zoom In & Out (Beat Sync)`: 検出ビートごとに寄り/引きを交互に切替
  - `Analyze Beats` 後の利用を推奨
- `Zoom In & Out (Loop)`: 時間ベースでヌメっと寄り/戻り
  - 非対称周期（目安: 寄り約4秒 + 戻り約5秒）
  - ビート解析済みの場合は強弱が穏やかに変化
- `Zoom Sine Smooth (tmix optional)`: サイン波ズーム + 任意のフレームブレンド
  - 彩度アップは廃止
  - `Motion blur strength` でtmix量を調整（`0.00`でオフ）

## スライダー
すべて `0.00 ~ 1.00`。

- `Zoom strength`: 上げるほどズームが強くなる
- `Bounce strength`: 上げるほどビート時の跳ねが大きくなる
- `Beat sensitivity`: 上げるほどビート検出点が増える
- `Motion blur strength`:
  - `0.00` = ブラーなし
  - `0.01 - 0.33` = 弱め
  - `0.34 - 0.66` = 中程度
  - `0.67 - 1.00` = 強め

## 初心者向け Step by Step
1. アプリ起動
2. `Verify FFmpeg` を押す
3. `Select & Open Video` で動画を選ぶ
4. 自動入力された `Output path` を確認
5. `Zoom mode` とスライダーを調整
6. `Apply Effects` を押す
7. `Zoom In & Out (Beat Sync)` を使う場合は `Analyze Beats`
8. （任意）`Render Preview`
9. `Preset` と `Encoder` を選ぶ
10. `Export Final`
11. 出力フォルダで次の3つを確認:
   - 書き出し動画（`.mp4`）
   - 実行ログ（`.json`）
   - フィルタースクリプト（`.filter_script.txt`）

## 開発起動
```powershell
npm install
npm.cmd run tauri dev
```