//! The main window is a card that can be made larger. Past the width it was designed at,
//! the whole page is drawn larger in proportion, so a bigger window is a bigger Six and
//! never a narrow column in an empty frame. Pure: sizes in, a scale or a size out.

/// The width the page is designed at, in points. At this width nothing is scaled.
pub const BASE_WIDTH: f64 = 480.0;
/// The largest the page is ever drawn: a window 720 points wide.
pub const MAX_SCALE: f64 = 1.5;

/// The limits of the window, in points, title bar included (the same as `tauri.conf.json`).
pub const MIN_SIZE: (f64, f64) = (360.0, 520.0);
pub const MAX_SIZE: (f64, f64) = (720.0, 1140.0);

/// How large the page is drawn in a window `width` points wide. Narrower than the design
/// width the page reflows at its normal size, as it always has; wider, it grows with the
/// window. Rounded to hundredths, so a drag passes through steady values.
pub fn page_scale(width: f64) -> f64 {
    if !width.is_finite() {
        return 1.0;
    }
    let raw = (width / BASE_WIDTH).clamp(1.0, MAX_SCALE);
    (raw * 100.0).round() / 100.0
}

/// A window size as it is remembered between launches: "600x700".
pub fn format_size(width: f64, height: f64) -> String {
    format!("{}x{}", width.round() as i64, height.round() as i64)
}

/// A remembered size, if it is one this window can have. Anything else is forgotten
/// rather than trusted, and the window opens at its usual size.
pub fn parse_size(stored: &str) -> Option<(f64, f64)> {
    let (w, h) = stored.trim().split_once('x')?;
    let (w, h): (f64, f64) = (w.parse().ok()?, h.parse().ok()?);
    let fits = (MIN_SIZE.0..=MAX_SIZE.0).contains(&w) && (MIN_SIZE.1..=MAX_SIZE.1).contains(&h);
    fits.then_some((w, h))
}

/// A remembered size, made to fit the screen it is about to open on. `room` is the
/// screen's usable area (no menu bar, no Dock) when it is known. Never below the window's
/// own minimum, which the screen cannot be smaller than in practice.
pub fn fit(size: (f64, f64), room: Option<(f64, f64)>) -> (f64, f64) {
    let Some((room_w, room_h)) = room else {
        return size;
    };
    (
        size.0.min(room_w).max(MIN_SIZE.0),
        size.1.min(room_h).max(MIN_SIZE.1),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_page_is_its_own_size_up_to_the_design_width_and_grows_with_the_window_after() {
        assert_eq!(page_scale(360.0), 1.0, "a narrow window reflows; it never shrinks the type");
        assert_eq!(page_scale(480.0), 1.0);
        assert_eq!(page_scale(600.0), 1.25);
        assert_eq!(page_scale(720.0), 1.5);
        assert_eq!(page_scale(2000.0), 1.5, "never more than half as large again");
        assert_eq!(page_scale(533.0), 1.11);
        assert_eq!(page_scale(f64::NAN), 1.0);
        assert_eq!(page_scale(0.0), 1.0);
    }

    #[test]
    fn a_remembered_size_never_opens_larger_than_the_screen() {
        // Chosen on a tall display, reopened on a laptop with 866 points of usable height.
        assert_eq!(fit((720.0, 1140.0), Some((1470.0, 866.0))), (720.0, 866.0));
        assert_eq!(fit((600.0, 700.0), Some((1470.0, 866.0))), (600.0, 700.0), "what fits is left alone");
        assert_eq!(fit((600.0, 700.0), None), (600.0, 700.0), "no screen known: trust the size");
        assert_eq!(fit((720.0, 900.0), Some((300.0, 300.0))), (360.0, 520.0), "never under the minimum");
    }

    #[test]
    fn a_remembered_size_round_trips_and_a_bad_one_is_forgotten() {
        assert_eq!(format_size(600.4, 699.6), "600x700");
        assert_eq!(parse_size("600x700"), Some((600.0, 700.0)));
        assert_eq!(parse_size(" 720x1140 "), Some((720.0, 1140.0)));
        assert_eq!(parse_size("5000x700"), None, "wider than the window can be");
        assert_eq!(parse_size("600x100"), None);
        assert_eq!(parse_size("360x520"), Some((360.0, 520.0)), "the smallest the window goes");
        assert_eq!(parse_size("360x519"), None);
        assert_eq!(parse_size("600"), None);
        assert_eq!(parse_size("axb"), None);
        assert_eq!(parse_size(""), None);
    }
}
