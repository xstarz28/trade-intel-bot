// Windows: prevent an extra console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    xstarz_analysis_lib::run()
}
