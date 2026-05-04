import { createContext } from 'react';
import EventEmitter from 'eventemitter3';

export const RoleContext = createContext(null);
export const roleEmitter = new EventEmitter();
