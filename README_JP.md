# naVShorts (Windows)

Windows向けの縦動画作成アプリです。  
技術スタック: **Tauri + Rust + FFmpeg**

## ワークフロー
- `1. Reframe`（1段目。起動時はこのタブを表示）
- `2. Effects`（2段目）

## 主な機能
- 横動画を9:16縦動画へ変換
- 顔参照フォルダによる人物追従
- エフェクト（zoom / beat bounce / motion blur）
- 書き出し進捗とETA表示
- 出力動画の横にログ（`.json`）とフィルタースクリプト（`.filter_script.txt`）保存

## UIメモ
- 上部タブで現在のワークスペースが分かる表示
- アプリ名 `naVShorts` とカスタムアイコンを表示
- 最後に使った値を次回起動時に復元
  - Effects: zoom関連、bounce、beat sensitivity、motion blur、preset、encoder
  - Reframe: tracking strength、identity threshold、stability、encoder
- Status欄は固定サイズ + 内部スクロールで、長文ログでもレイアウト崩れを抑制

## Reframe画質（現行）
- プレビュー: `540x960`
- 本番Reframe出力は入力解像度に応じて自動切替
  - 4Kクラス入力（幅>=3000 または 高さ>=1700）: `2160x3840`
  - それ以外: `1080x1920`
- Reframe本番のエンコード品質を引き上げ
  - CPU x264: CRFを低く、presetを品質寄りに調整
  - NVIDIA/Intel/AMD: CQ/QP/quality系を品質寄りに調整

## Effects側プリセット
- YouTube Shorts `1080x1920`
- Instagram Reels `1080x1920`
- Vertical 4K `2160x3840`

## 大容量モデル（未push）
ONNXはGitHubサイズ制限のためgit除外しています。配置先:
- `src-tauri/resources/models/`

### 顔検出モデル
- 取得元: UltraFace ONNX
- URL: https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB/tree/master/models/onnx
- 元ファイル名: `version-RFB-320-int8.onnx`
- アプリ側ファイル名: `face_detector.onnx`

### 顔特徴量モデル（ArcFace）
- 取得元: ONNX Model Zoo ArcFace
- URL: https://github.com/onnx/models/tree/main/validated/vision/body_analysis/arcface
- 元ファイル名: `arcfaceresnet100-8.onnx`
- アプリ側ファイル名: `arcface.onnx`

## 開発起動
```powershell
npm install
npm.cmd run tauri dev
```