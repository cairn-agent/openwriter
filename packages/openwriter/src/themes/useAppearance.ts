import { useEffect, useState } from 'react';
import {
  APPEARANCE_CHANGE_EVENT, getCanvasStyle, getMode, getSidebarMode, getSpacing, getTypeface,
} from './appearance-store';

function read() {
  return {
    typeface: getTypeface(),
    mode: getMode(),
    sidebarMode: getSidebarMode(),
    spacing: getSpacing(),
    canvas: getCanvasStyle(),
  };
}

/** The current appearance settings, re-read whenever any control changes one. */
export function useAppearance() {
  const [state, setState] = useState(read);
  useEffect(() => {
    const onChange = () => setState(read());
    window.addEventListener(APPEARANCE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(APPEARANCE_CHANGE_EVENT, onChange);
  }, []);
  return state;
}
