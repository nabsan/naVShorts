use std::path::PathBuf;
use std::process::Command;

fn ffmpeg_exists() -> bool {
    Command::new("where")
        .arg("ffmpeg")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[test]
#[ignore = "Requires ffmpeg installed"]
fn happy_path_with_audio_sample() {
    if !ffmpeg_exists() {
        return;
    }

    let temp = tempfile::tempdir().expect("tempdir");
    let in_path = temp.path().join("input.mp4");
    let out_path = temp.path().join("output.mp4");

    let gen = Command::new("ffmpeg")
        .args([
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=1280x720:rate=30",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=44100",
            "-t",
            "2",
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            in_path.to_str().expect("utf8"),
        ])
        .output()
        .expect("generate sample");
    assert!(gen.status.success());

    let render = Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            in_path.to_str().expect("utf8"),
            "-vf",
            "scale='if(gt(a,9/16),-2,1080)':'if(gt(a,9/16),1920,-2)',crop=1080:1920",
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            out_path.to_str().expect("utf8"),
        ])
        .output()
        .expect("render sample");
    assert!(render.status.success());
    assert!(out_path.exists());
}

#[test]
#[ignore = "Requires ffmpeg installed"]
fn invalid_input_reports_failure() {
    if !ffmpeg_exists() {
        return;
    }

    let temp = tempfile::tempdir().expect("tempdir");
    let missing = PathBuf::from(temp.path().join("does_not_exist.mp4"));

    let out = Command::new("ffmpeg")
        .args(["-v", "error", "-i", missing.to_str().expect("utf8"), "-f", "null", "-"])
        .output()
        .expect("ffmpeg run");

    assert!(!out.status.success());
}