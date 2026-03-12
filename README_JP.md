# naVShorts (Windows)

naVShorts は、縦型ショート動画向けの Windows デスクトップアプリです。  
技術スタックは **Tauri + Rust + FFmpeg** です。

## ワークフロー
- `1. Reframe`（最初に使う。起動時デフォルト）
- `2. Effects`（次に使う）

## 主な機能
- 横動画を 9:16 の縦動画へ変換
- ターゲット顔フォルダによる顔追従
- エフェクト（Zoom / Beat Bounce / Motion Blur）
- レンダー進捗と ETA 表示
- 出力動画と同じ場所にログ保存（`.json`）
- 同じ場所に FFmpeg フィルタースクリプト保存（`.filter_script.txt`）

## UIメモ
- 上部タブでワークスペースを切替
- アプリ名 `naVShorts` と専用アイコンを表示
- 最後に使った値を次回起動時に復元
- Effects 側で保存される項目: zoom mode/strength, bounce, beat sensitivity, motion blur, preset, encoder
- Reframe 側で保存される項目: tracking strength, identity threshold, stability, encoder
- Status は固定サイズ + 内部スクロールで長文でもレイアウト崩れを防止

## Reframe画質（現状）
- プレビュー: `540x960`
- 本番出力は入力解像度で自動切替
- 4Kクラス入力（幅>=3000 または 高さ>=1700）: `2160x3840`
- それ以外: `1080x1920`
- 本番出力時のエンコーダ品質を強化済み
- CPU x264: CRF を下げ、preset を高品質寄りに調整
- NVIDIA/Intel/AMD: CQ/QP/quality を高品質寄りに調整

## 顔追従の調整ガイド
推奨の初期値:
- `Face tracking strength`: `0.72`
- `Stability`: `0.68`
- `Identity threshold`: `0.58`

調整ルール:
1. 追従が弱い、見失いやすい。
- `Face tracking strength` を `+0.05` ずつ上げる（目安 `0.80-0.90`）。
2. 画面の動きが落ち着かない、揺れが強い。
- `Stability` を `+0.05` ずつ上げる（目安 `0.75-0.85`）。
3. 別人へジャンプしやすい。
- `Identity threshold` を `+0.03` から `+0.05` 上げる。
4. 顔を見失うことが多い。
- `Identity threshold` を少し下げる、または `Face tracking strength` を上げる。

ダンス動画向けの実用プリセット:
- `tracking 0.78 / stability 0.76 / identity threshold 0.58`

## Effects出力プリセット
- YouTube Shorts `1080x1920`
- Instagram Reels `1080x1920`
- Vertical 4K `2160x3840`

## 大容量モデルファイル（Git未push）
ONNX ファイルは GitHub サイズ制限のためリポジトリに含めていません。  
配置先:
- `src-tauri/resources/models/`

### 顔検出モデル
- 入手元: UltraFace ONNX
- URL: https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB/tree/master/models/onnx
- 元ファイル名: `version-RFB-320-int8.onnx`
- アプリでの配置名: `face_detector.onnx`

### 顔特徴量モデル（ArcFace）
- 入手元: ONNX Model Zoo ArcFace
- URL: https://github.com/onnx/models/tree/main/validated/vision/body_analysis/arcface
- 元ファイル名: `arcfaceresnet100-8.onnx`
- アプリでの配置名: `arcface.onnx`

## 開発
```powershell
npm install
npm.cmd run tauri dev
```
