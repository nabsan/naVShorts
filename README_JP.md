# naVShorts (Windows)

Windows向けの縦動画作成アプリです。  
技術スタック: **Tauri + Rust + FFmpeg**

## できること
- Shorts / Reels / TikTok向けの9:16動画を作成
- UIを混在させない2ワークスペース構成
  - **Reframe Workspace**: 横動画 -> 縦動画のベース作成（人物追従）
  - **Effects Workspace**: ズーム/バウンス演出と最終書き出し
- 書き出し中の進捗とETA表示
- 出力動画の横にログ（`.json`）とフィルタースクリプト（`.filter_script.txt`）保存

## 現在のワークスペース

### 1) Reframe Workspace（Step 1）
- ソース動画を選択
- **Target face folder**（同一人物の顔写真フォルダ）を選択
- スライダー調整:
  - `Face tracking strength`（初期値 `0.72`）
  - `Identity threshold`（初期値 `0.58`）
  - `Stability`（初期値 `0.68`）
- プレビュー書き出し / 本番書き出し
- `Send Reframed Video To Effects` でEffectsへ受け渡し

### 2) Effects Workspace（Step 2）
- 動画を開く（Reframeからの受け渡し可）
- エフェクト:
  - `None`
  - `Zoom In`
  - `Zoom Out`
  - `Zoom In & Out (Beat Sync)`
  - `Zoom In & Out (Loop)`
  - `Zoom Sine Smooth`
- スライダー:
  - `Zoom strength`
  - `Bounce strength`
  - `Beat sensitivity`
  - `Motion blur strength`
- 必要なら `Analyze Beats`
- 最終書き出し

## 書き出し仕様
- プリセット:
  - `YouTube Shorts (1080x1920)`
  - `Instagram Reels (1080x1920)`
  - `Vertical 4K (2160x3840)`
- プレビュー: `540x960`
- 映像/音声: `H.264 + AAC`（拡張子に応じてMP4/MOV）
- エンコーダー:
  - `Auto`（推奨）
  - `CPU`
  - `NVIDIA (NVENC)` / `Intel (QSV)` / `AMD (AMF)`（環境依存）

## 初心者向け Step by Step
1. `Verify FFmpeg/ONNX` を押す
2. `Open Reframe Workspace` を開く
3. `Select Source Video` で横動画を選ぶ
4. `Select Target Face Folder` で対象人物の顔写真フォルダを選ぶ
5. まずは初期値のまま追従スライダーで試す
6. `Export Reframed Video`
7. `Send Reframed Video To Effects`
8. Effects側でZoom modeとスライダーを調整
9. （必要なら）`Analyze Beats`
10. 出力パス / preset / encoder を設定
11. `Export Final`
12. 出力フォルダで以下を確認
   - 動画ファイル
   - `.json`ログ
   - `.filter_script.txt`

## スライダーの意味（要点）
- `Face tracking strength` を上げる: 追従更新が細かくなる
- `Identity threshold` を上げる: 同一人物判定を厳しくする（上げすぎると見失いやすい）
- `Stability` を上げる: 画角移動が滑らかになる（反応は遅め）
- `Zoom strength` を上げる: ズーム演出が強くなる
- `Bounce strength` を上げる: ビート時の揺れが大きくなる
- `Beat sensitivity` を上げる: ビート検出数が増える
- `Motion blur strength` を上げる: ブラーが強くなる

## 大容量モデル（Git未push）の取得元とリネーム
この2つのONNXは大容量のため、GitHubへはpushしていません（100MB制限対策）。  
配置先は **`src-tauri/resources/models/`** です。

### A) 顔検出モデル
- 取得元（UltraFace ONNX）:
  - [https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB/tree/master/models/onnx](https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB/tree/master/models/onnx)
- 元ファイル名: `version-RFB-320-int8.onnx`
- アプリが参照する名前: `face_detector.onnx`
- このリポジトリ運用では、`version-RFB-320-int8.onnx` を `face_detector.onnx` にリネーム（またはコピー）して使用

### B) 顔特徴量モデル（ArcFace）
- 取得元（ONNX Model Zoo ArcFace）:
  - [https://github.com/onnx/models/tree/main/validated/vision/body_analysis/arcface](https://github.com/onnx/models/tree/main/validated/vision/body_analysis/arcface)
- 元ファイル名: `arcfaceresnet100-8.onnx`
- アプリが参照する名前: `arcface.onnx`
- このリポジトリ運用では、`arcfaceresnet100-8.onnx` を `arcface.onnx` にリネーム（またはコピー）して使用

## なぜpushしないか
- `.gitignore` で `*.onnx` を除外済み
- 理由: リポジトリ軽量化とGitHubのサイズ制限回避

## 開発起動
```powershell
npm install
npm.cmd run tauri dev
```
