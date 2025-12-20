mod app;
mod cli;
mod data;
mod theme;
mod ui;
mod widgets;

use std::io;
use std::time::Duration;

use anyhow::Result;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{backend::CrosstermBackend, Terminal};

use app::App;

fn main() -> Result<()> {
    // Parse command line args
    let args: Vec<String> = std::env::args().collect();
    let init_mode = args.iter().any(|arg| arg == "--init");

    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Create app
    let app_result = App::new(init_mode);
    let mut app = match app_result {
        Ok(app) => app,
        Err(e) => {
            // Restore terminal before printing error
            restore_terminal(&mut terminal)?;
            eprintln!("Failed to initialize: {}", e);
            std::process::exit(1);
        }
    };

    // Main loop
    let result = run_app(&mut terminal, &mut app);

    // Restore terminal
    restore_terminal(&mut terminal)?;

    if let Err(e) = result {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    }

    Ok(())
}

fn run_app<B: ratatui::backend::Backend + io::Write>(
    terminal: &mut Terminal<B>,
    app: &mut App,
) -> Result<()> {
    loop {
        // Check for CLI info updates
        app.poll_cli_info();

        // Handle login flow request
        if app.needs_login_flow {
            app.needs_login_flow = false;
            run_login_flow(terminal, app)?;
            continue;
        }

        terminal.draw(|f| ui::draw(f, app))?;

        // Poll for events with timeout
        if event::poll(Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                // Only handle key press events (not release)
                if key.kind == KeyEventKind::Press {
                    app.handle_key(key);
                }
            }
        }

        if app.should_quit {
            break;
        }
    }

    Ok(())
}

/// Run the login flow by suspending TUI and calling CLI
fn run_login_flow<B: ratatui::backend::Backend + io::Write>(
    terminal: &mut Terminal<B>,
    app: &mut App,
) -> Result<()> {
    // Restore terminal to normal mode
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    // Run the login command
    println!("\n");
    let success = cli::run_interactive_command(&["--login"]).unwrap_or(false);

    // Show result and wait for keypress
    if success {
        println!("\n✓ Login successful!");
    } else {
        println!("\n✗ Login failed or cancelled.");
    }
    println!("\nPress any key to continue...");

    // Wait for a keypress
    enable_raw_mode()?;
    loop {
        if event::poll(Duration::from_millis(100))? {
            if let Event::Key(_) = event::read()? {
                break;
            }
        }
    }
    disable_raw_mode()?;

    // Re-enter TUI mode
    execute!(
        terminal.backend_mut(),
        EnterAlternateScreen,
        EnableMouseCapture
    )?;
    enable_raw_mode()?;
    terminal.hide_cursor()?;
    terminal.clear()?;

    // Handle wizard mode differently
    if app.is_wizard_mode() {
        app.wizard_oauth_complete(success);
    } else {
        // Refresh CLI info after login
        app.refresh_cli_info();
        app.status_message = Some(if success {
            "Login successful".to_string()
        } else {
            "Login cancelled".to_string()
        });
    }

    Ok(())
}

fn restore_terminal<B: ratatui::backend::Backend + io::Write>(
    terminal: &mut Terminal<B>,
) -> Result<()> {
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;
    Ok(())
}
