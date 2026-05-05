import { createContext } from 'react';
// Lighter sign-out: clears role + task state but preserves name/dept in AsyncStorage
// so the next shift login skips setup.
export const EndDayContext = createContext(() => {});
