/**
 * Starter prompts for new users without existing projects.
 * These rotate in a floating button to inspire first-time users.
 */

export interface StarterPrompt {
  /** Short label shown on the button */
  label: string;
  /** Full prompt to fill in the text area */
  prompt: string;
  /** Suggested repo name for the project */
  repoName: string;
}

export const starterPrompts: StarterPrompt[] = [
  {
    label: 'Create a Sudoku app',
    prompt: `Create a Sudoku puzzle game with the following features:
- Generate valid Sudoku puzzles with multiple difficulty levels (easy, medium, hard)
- Clean, minimal UI with a 9x9 grid
- Highlight row, column, and 3x3 box when a cell is selected
- Input validation that shows conflicts in red
- Timer to track solve time
- "Check solution" and "Reveal solution" buttons

Tech stack: React + TypeScript + Vite + Tailwind CSS`,
    repoName: 'sudoku-app',
  },
  {
    label: 'Create a Tic Tac Toe game',
    prompt: `Create a Tic Tac Toe game with the following features:
- Two-player mode (X and O take turns)
- Clean, responsive UI with a 3x3 grid
- Highlight the winning line when someone wins
- Show game status (whose turn, winner, or draw)
- "New Game" button to reset
- Optional: Add a simple AI opponent

Tech stack: React + TypeScript + Vite + Tailwind CSS`,
    repoName: 'tic-tac-toe',
  },
  {
    label: 'Create a Connect Four game',
    prompt: `Create a Connect Four game with the following features:
- Two-player mode (Red and Yellow take turns)
- 7 columns x 6 rows grid with drop animation
- Click a column to drop a piece
- Detect wins (4 in a row: horizontal, vertical, diagonal)
- Highlight the winning pieces
- Show game status and "New Game" button

Tech stack: React + TypeScript + Vite + Tailwind CSS`,
    repoName: 'connect-four',
  },
  {
    label: 'Create a Memory Match game',
    prompt: `Create a Memory Match (concentration) card game with the following features:
- 4x4 grid of cards (8 pairs)
- Cards flip with a smooth animation
- Match pairs to remove them from the board
- Track number of moves and time
- Win screen when all pairs are matched
- "New Game" button to shuffle and restart

Tech stack: React + TypeScript + Vite + Tailwind CSS`,
    repoName: 'memory-match',
  },
  {
    label: 'Create a Snake game',
    prompt: `Create a classic Snake game with the following features:
- Snake moves continuously in the current direction
- Arrow keys or WASD to change direction
- Eat food to grow longer and increase score
- Game over when hitting walls or self
- Display current score and high score
- "Play Again" button after game over

Tech stack: React + TypeScript + Vite + Tailwind CSS + HTML Canvas`,
    repoName: 'snake-game',
  },
];

/**
 * Get a random starter prompt
 */
export function getRandomStarterPrompt(): StarterPrompt {
  return starterPrompts[Math.floor(Math.random() * starterPrompts.length)];
}
