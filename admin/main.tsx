// The admin bundle's entry: mount the app into the shell's one element, with
// the stylesheet (Vite writes it beside this script as admin.css).
import { render } from 'preact';
import { App } from './app.tsx';
import './admin.css';

const root = document.getElementById('admin');
if (root) render(<App />, root);
