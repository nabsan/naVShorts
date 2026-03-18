# naVShorts (Windows)

naVShorts は、縦向きショート動画を作るための Windows デスクトップアプリです。  
構成は **Tauri + Rust + FFmpeg** です。

## ワークフロー
- `1. Reframe`: 横長動画を縦 `9:16` に変換し、人物追従しながら書き出す
- `1B. Reframe Assist`: 手動で顔矩形アンカーを置き、Assist JSON を保存して `1. Reframe` で再利用する
- `2. Effects`: ズーム、ビート連動、モーションブラーなどを加えて最終書き出しする

## 主な機能
- 横長から縦長 `9:16` への変換
- `Target face folder path` を使った本人追跡
- 複数の Reframe 追跡エンジン
  - `Face Identity (ONNX)`
  - `Person YOLO + DeepSORT`
  - `Person YOLO + ByteTrack + ArcFace`
  - `Manual Assist JSON`
- `Reframe Assist` での動画プレビュー再生と手動顔矩形アンカー入力
- 手動 + 自動のハイブリッド Assist 追跡
  - 手動アンカーを基準にする
  - アンカー間だけ自動追跡を補助的に混ぜる
  - 利用できる Assist 追跡エンジン:
    - `Manual only`
    - `Assist with Face Identity (ONNX)`
    - `Assist with YOLO + ByteTrack + ArcFace`
    - `Assist with YOLO + DeepSORT`
- Effects ワークスペース
  - 各種ズーム
  - ビート連動バウンス
  - モーションブラー
- レンダー進捗と ETA 表示
- 出力動画の横に `.json` ログと `.filter_script.txt` を保存

## Reframe 画質
- Assist プレビュー再生は軽量 proxy 動画を使います
- 最終 Reframe 出力はソース解像度に応じて自動選択されます
  - 4Kクラス入力 (`幅 >= 3000` または `高さ >= 1700`): `2160x3840`
  - それ以外: `1080x1920`
- 本番書き出しはプレビューより高画質になるよう調整済みです

## 追跡パラメータの推奨初期値
追跡エンジンごとの推奨値:
- `Face Identity (ONNX)`: `tracking 0.78 / id 0.58 / stability 0.76`
- `Person YOLO + DeepSORT`: `tracking 0.80 / id 0.60 / stability 0.74`
- `Person YOLO + ByteTrack + ArcFace`: `tracking 0.84 / id 0.66 / stability 0.82`
- `Manual Assist JSON`: `tracking 0.72 / id 0.58 / stability 0.84`

調整ルール:
1. 追跡が弱い、またはターゲットを見失いやすい
- `Face tracking strength` を `+0.05` ずつ上げる
2. 動きが落ち着かず、ブレやすい
- `Stability` を `+0.05` ずつ上げる
3. 別の人へジャンプしやすい
- `Identity threshold` を `+0.03` から `+0.05` 上げる
4. 顔を拾えない場面が多い
- `Identity threshold` を少し下げる、または `Face tracking strength` を上げる

## Reframe Assist の使い方
1. `1B. Reframe Assist` を開く
2. 元動画を選ぶ
3. ハイブリッド追跡を使いたい場合は `Target face folder path` を選ぶ
4. `Assist tracking engine` を選ぶ
5. プレビューを再生し、ずれそうな場所だけ停止して顔矩形を置く
6. `Save Assist JSON` で保存する
7. `Send Assist JSON To Reframe` を押す
8. `1. Reframe` 側では `Tracking engine = Manual Assist JSON` のまま export する

ポイント:
- 手動アンカーは常に優先されます
- 自動追跡は主にアンカー間の中間部分で補助として効きます
- つまり、全フレーム手で打つのではなく、ずれた箇所だけ直す運用を狙っています
- 自動追跡がうまくいかない区間でも、手動アンカーがあるので破綻しにくいです

## Effects の出力プリセット
- YouTube Shorts `1080x1920`
- Instagram Reels `1080x1920`
- Vertical 4K `2160x3840`

## Git に含めないランタイム資産
GitHub のサイズ制限を避けるため、ONNX などの大きいモデルは push していません。  
配置先:
- `src-tauri/resources/models/`

### 顔検出モデル
- 入手元: UltraFace ONNX
- URL: https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB/tree/master/models/onnx
- 元ファイル名: `version-RFB-320-int8.onnx`
- アプリで使うファイル名: `face_detector.onnx`

### 顔特徴量モデル (ArcFace)
- 入手元: ONNX Model Zoo ArcFace
- URL: https://github.com/onnx/models/tree/main/validated/vision/body_analysis/arcface
- 元ファイル名: `arcfaceresnet100-8.onnx`
- アプリで使うファイル名: `arcface.onnx`

### YOLO モデル
- 実行時モデル: `src-tauri/yolov8n.pt`
- 入手元: Ultralytics が初回実行時に自動ダウンロードする `yolov8n.pt`

### Ultralytics キャッシュ
- フォルダ: `Ultralytics/`
- 用途: Ultralytics がローカルに生成する設定/キャッシュ

## 開発
```powershell
npm install
npm.cmd run tauri dev
```

## 最近の更新
- `1B. Reframe Assist` ワークスペースを追加
- Assist プレビュー再生を `asset.localhost` 直再生から blob ベースへ切り替えて安定化
- Assist JSON の保存 / 読み込みフローを追加
- `1. Reframe` に `Manual Assist JSON` モードを追加
- `Target face folder path` と自動追跡エンジンを使ったハイブリッド Assist 追跡を追加
- `1. Reframe` 側で Assist JSON から target face folder 情報を自動反映するよう改善
