import { EventEmitter } from 'events';
import { FintechEvent, EventType } from '../types';

/**
 * In-process event bus wrapping Node EventEmitter.
 * Interface is designed to be drop-in replaceable with a Kafka producer/consumer
 * by swapping only this module — callers use publish() / subscribe() throughout.
 */
class EventBus extends EventEmitter {
  publish<T>(event: FintechEvent<T>): void {
    this.emit(event.type, event);
    this.emit('*', event);   // wildcard — risk engine and CRE subscribe here
  }

  subscribe<T>(type: EventType | '*', handler: (event: FintechEvent<T>) => void): void {
    this.on(type, handler as (event: FintechEvent<unknown>) => void);
  }

  unsubscribe<T>(type: EventType | '*', handler: (event: FintechEvent<T>) => void): void {
    this.off(type, handler as (event: FintechEvent<unknown>) => void);
  }
}

// Singleton — the whole process shares one bus
export const eventBus = new EventBus();
eventBus.setMaxListeners(50);
