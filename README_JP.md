# naVShorts (Windows)

naVShorts は、縦向きショート動画を作るための Windows デスクトップアプリです。  
構成は **Tauri + Rust + FFmpeg** です。

## RC1 状態
現在の repository 状態を `rc1` として扱います。  
`rc1` は、主要なエンドツーエンドの作業フローが日常利用に十分安定しており、今後は主に細かな改善や磨き込みを続ける段階、という意味です。

## ワークフロー
- `1. Pre Reframe`: 手動の顔矩形アンカーを置き、Assist JSON を作って Reframe の下準備をする
- `2. Reframe`: 横長動画を縦 `9:16` に変換し、人物追従しながら書き出す
- `3. Effects`: ズーム、ビート連動、モーションブラーなどを加えて最終書き出しする
- `4. Settings`: 共通フォルダ、ランタイム確認、各画面の初期モードを管理する

## 主な機能
- 横長から縦長 `9:16` への変換
- `Target face folder path` を使った本人追跡
- 複数の Reframe 追跡エンジン
  - `Face Identity (ONNX)`
  - `Person YOLO + DeepSORT`
  - `Person YOLO + ByteTrack + ArcFace`
  - `Manual Assist JSON`
- `Pre Reframe` での動画プレビュー再生と手動顔矩形アンカー入力
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
- `Settings` で共通フォルダ、初期モード、FFmpeg / ONNX 確認を管理
- `Reset Remembered UI State` により、バックアップを書き出してから UI の記憶状態を初期化可能

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

## Pre Reframe の使い方
1. `1. Pre Reframe` を開く
2. 元動画を選ぶ
3. ハイブリッド追跡を使いたい場合は `Target face folder path` を選ぶ
4. `Assist tracking engine` を選ぶ
5. プレビューを再生し、ずれそうな場所だけ停止して顔矩形を置く
6. `Save Assist JSON` で保存する
7. `Send Assist JSON To Reframe` を押す
8. `2. Reframe` 側では `Tracking engine = Manual Assist JSON` のまま export する

ポイント:
- 手動アンカーは常に優先されます
- 自動追跡は主にアンカー間の中間部分で補助として効きます
- つまり、全フレーム手で打つのではなく、ずれた箇所だけ直す運用を狙っています
- 自動追跡がうまくいかない区間でも、手動アンカーがあるので破綻しにくいです
- 同じソース動画を開き直した場合は、条件が一致すれば preview proxy を再利用します
- 既定では現在の推定枠だけを表示し、必要なら `Show all saved anchors` で全アンカー表示に切り替えられます
- ショートカット:
  - `Space`: 再生 / 一時停止
  - `J`: 3秒戻る
  - `L`: 3秒進む
  - `Left / Right`: 約1フレーム移動

## Effects の使い方
- `Render Preview` と `Export Final` の前に、アプリが自動で
  - `Analyze Beats`
  - `Apply Effects`
  の順で実行します
- Preview 出力は `_preview` postfix 付きファイル名になります
- Preview は軽量設定で出力されるため、本番より速く確認用に使えます
- 入力パスに日本語などの非ASCII文字が含まれる場合、Beat Analysis は一時的に ASCII-only の temp コピーを使って処理します

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
- ワークスペース構成を `1. Pre Reframe / 2. Reframe / 3. Effects / 4. Settings` に整理
- `Settings` で共通フォルダ、各画面の初期モード、FFmpeg / ONNX 確認を管理できるよう改善
- `Reset Remembered UI State` を追加し、バックアップ保存後に UI の記憶状態を初期化できるようにした
- Assist プレビュー再生を `asset.localhost` 直再生から blob ベースへ切り替えて安定化
- Assist JSON の保存 / 読み込みフローを追加
- `2. Reframe` に `Manual Assist JSON` モードを追加
- `Target face folder path` と自動追跡エンジンを使ったハイブリッド Assist 追跡を追加
- `2. Reframe` 側で Assist JSON から target face folder 情報を自動反映するよう改善
- `1. Pre Reframe` で preview proxy キャッシュ再利用、現在枠中心表示、ショートカット操作を追加
- `3. Effects` では Preview / Final のどちらでも自動で `Analyze Beats -> Apply Effects` を実行するよう改善
- Effects Preview は `_preview` ファイル名で軽量設定出力するよう改善
- 非ASCIIパスの動画でも Beat Analysis が通るよう、一時的な ASCII-only temp コピー経由の回避処理を追加
