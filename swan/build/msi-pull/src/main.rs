//! Tiny helper for the SWAN cross build: pull single files (e.g. d3dcompiler_47.dll) out of a
//! Windows SDK .msi + its .cab payloads. xwin only fetches headers/libs, but Chromium's ANGLE
//! copies Redist/D3D/x64/d3dcompiler_47.dll from the SDK.
//!
//!   msi-pull list    <msi> <needle>                    show Media + matching File rows
//!   msi-pull extract <msi> <cab_dir> <needle> <out>    write matches to <out>/<dir path>/<name>
use anyhow::{anyhow, Context, Result};
use msi::{Package, Select};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io;
use std::path::PathBuf;

struct Entry { key: String, name: String, dir: String, seq: i32, size: i32 }

fn long_name(s: &str) -> String { s.split('|').last().unwrap_or(s).to_string() }

fn load(pkg: &mut Package<File>, needle: &str) -> Result<(Vec<Entry>, Vec<(i32, String)>)> {
    // Directory tree
    let mut dirs: HashMap<String, (Option<String>, String)> = HashMap::new();
    for row in pkg.select_rows(Select::table("Directory"))? {
        let id = row["Directory"].as_str().unwrap_or("").to_string();
        let parent = row["Directory_Parent"].as_str().map(|s| s.to_string());
        let def = long_name(row["DefaultDir"].as_str().unwrap_or(""));
        dirs.insert(id, (parent, def));
    }
    let dir_path = |mut id: String| -> String {
        let mut parts = vec![];
        for _ in 0..32 {
            match dirs.get(&id) {
                Some((parent, name)) => {
                    if name != "." && name != "SourceDir" && !name.is_empty() { parts.push(name.clone()); }
                    match parent { Some(p) if !p.is_empty() => id = p.clone(), _ => break }
                }
                None => break,
            }
        }
        parts.reverse();
        parts.join("/")
    };
    // Component -> Directory
    let mut comp_dir: HashMap<String, String> = HashMap::new();
    for row in pkg.select_rows(Select::table("Component"))? {
        comp_dir.insert(row["Component"].as_str().unwrap_or("").to_string(),
                        row["Directory_"].as_str().unwrap_or("").to_string());
    }
    let mut files = vec![];
    for row in pkg.select_rows(Select::table("File"))? {
        let name = long_name(row["FileName"].as_str().unwrap_or(""));
        if !name.to_lowercase().contains(&needle.to_lowercase()) { continue; }
        let comp = row["Component_"].as_str().unwrap_or("").to_string();
        let dir = dir_path(comp_dir.get(&comp).cloned().unwrap_or_default());
        files.push(Entry {
            key: row["File"].as_str().unwrap_or("").to_string(), name, dir,
            seq: row["Sequence"].as_int().unwrap_or(0), size: row["FileSize"].as_int().unwrap_or(0),
        });
    }
    let mut media = vec![];
    for row in pkg.select_rows(Select::table("Media"))? {
        media.push((row["LastSequence"].as_int().unwrap_or(0),
                    row["Cabinet"].as_str().unwrap_or("").to_string()));
    }
    media.sort();
    Ok((files, media))
}

fn cab_for(media: &[(i32, String)], seq: i32) -> Option<String> {
    media.iter().find(|(last, _)| *last >= seq).map(|(_, c)| c.trim_start_matches('#').to_string())
}

fn main() -> Result<()> {
    let a: Vec<String> = std::env::args().collect();
    match a.get(1).map(|s| s.as_str()) {
        Some("list") if a.len() == 4 => {
            let mut pkg = Package::open(File::open(&a[2])?)?;
            let (files, media) = load(&mut pkg, &a[3])?;
            println!("media: {:?}", media);
            for e in &files {
                println!("{:<40} {:>9}  seq={:<6} cab={:?}  {}/{}", e.key, e.size, e.seq, cab_for(&media, e.seq), e.dir, e.name);
            }
        }
        Some("extract") if a.len() == 6 => {
            let mut pkg = Package::open(File::open(&a[2])?)?;
            let (files, media) = load(&mut pkg, &a[4])?;
            if files.is_empty() { return Err(anyhow!("no file matches {:?}", a[4])); }
            for e in files {
                let cab_name = cab_for(&media, e.seq).ok_or_else(|| anyhow!("no cab for {}", e.key))?;
                let cab_path = PathBuf::from(&a[3]).join(&cab_name);
                let mut cabinet = cab::Cabinet::new(File::open(&cab_path).with_context(|| format!("open {:?}", cab_path))?)?;
                let mut reader = cabinet.read_file(&e.key).with_context(|| format!("{} in {}", e.key, cab_name))?;
                let out = PathBuf::from(&a[5]).join(&e.dir).join(&e.name);
                fs::create_dir_all(out.parent().unwrap())?;
                let n = io::copy(&mut reader, &mut File::create(&out)?)?;
                println!("wrote {:?} ({} bytes)", out, n);
            }
        }
        _ => return Err(anyhow!("usage: msi-pull list <msi> <needle> | extract <msi> <cab_dir> <needle> <out>")),
    }
    Ok(())
}
