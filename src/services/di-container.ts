/**
 * Dependency Injection Container
 * Provides service registration, resolution, and lifecycle management
 */

import type { Env } from '../env';
import { BaseAppError } from '../utils/errors';

/**
 * Service lifecycle states
 */
export type ServiceLifecycle = 'transient' | 'singleton' | 'scoped';

/**
 * Service registration metadata
 */
export interface ServiceRegistration<T = any> {
  factory: (container: DIContainer) => T;
  lifecycle: ServiceLifecycle;
  instance?: T;
  dependencies?: string[];
  initialized?: boolean;
}

/**
 * Service configuration for registration
 */
export interface ServiceConfig<T = any> {
  factory: (container: DIContainer) => T;
  lifecycle?: ServiceLifecycle;
  dependencies?: string[];
}

/**
 * Service lifecycle hooks
 */
export interface ServiceLifecycleHooks {
  onInit?: () => Promise<void> | void;
  onDestroy?: () => Promise<void> | void;
  onHealthCheck?: () => Promise<boolean> | boolean;
}

/**
 * Service with lifecycle hooks
 */
export interface ManagedService extends ServiceLifecycleHooks {
  readonly serviceName: string;
}

/**
 * Dependency Injection Container
 */
export class DIContainer {
  private services = new Map<string, ServiceRegistration>();
  private singletonInstances = new Map<string, any>();
  private scopedInstances = new Map<string, any>();
  private initializationOrder: string[] = [];
  private isShuttingDown = false;

  constructor(private env: Env) {}

  /**
   * Register a service with the container
   */
  register<T>(name: string, config: ServiceConfig<T>): void {
    if (this.services.has(name)) {
      throw new BaseAppError(
        'SERVICE_ALREADY_REGISTERED',
        `Service '${name}' is already registered`,
        { context: { serviceName: name } }
      );
    }

    const registration: ServiceRegistration<T> = {
      factory: config.factory,
      lifecycle: config.lifecycle || 'singleton',
      dependencies: config.dependencies || [],
      initialized: false
    };

    this.services.set(name, registration);
  }

  /**
   * Register a singleton service
   */
  registerSingleton<T>(name: string, factory: (container: DIContainer) => T, dependencies?: string[]): void {
    this.register(name, {
      factory,
      lifecycle: 'singleton',
      dependencies
    });
  }

  /**
   * Register a transient service
   */
  registerTransient<T>(name: string, factory: (container: DIContainer) => T, dependencies?: string[]): void {
    this.register(name, {
      factory,
      lifecycle: 'transient',
      dependencies
    });
  }

  /**
   * Register a scoped service
   */
  registerScoped<T>(name: string, factory: (container: DIContainer) => T, dependencies?: string[]): void {
    this.register(name, {
      factory,
      lifecycle: 'scoped',
      dependencies
    });
  }

  /**
   * Resolve a service by name
   */
  resolve<T>(name: string): T {
    if (this.isShuttingDown) {
      throw new BaseAppError(
        'CONTAINER_SHUTTING_DOWN',
        'Cannot resolve services during container shutdown',
        { context: { serviceName: name } }
      );
    }

    const registration = this.services.get(name);
    if (!registration) {
      throw new BaseAppError(
        'SERVICE_NOT_FOUND',
        `Service '${name}' is not registered`,
        { context: { serviceName: name, availableServices: Array.from(this.services.keys()) } }
      );
    }

    return this.createInstance<T>(name, registration);
  }

  /**
   * Check if a service is registered
   */
  isRegistered(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * Get all registered service names
   */
  getRegisteredServices(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Initialize all singleton services
   */
  async initialize(): Promise<void> {
    const singletonServices = Array.from(this.services.entries())
      .filter(([, registration]) => registration.lifecycle === 'singleton');

    // Sort by dependencies to ensure proper initialization order
    const sortedServices = this.topologicalSort(singletonServices.map(([name]) => name));

    for (const serviceName of sortedServices) {
      try {
        const instance = this.resolve(serviceName);
        
        // Call initialization hook if available
        if (this.isManagedService(instance)) {
          await instance.onInit?.();
        }

        this.initializationOrder.push(serviceName);
      } catch (error: unknown) {
        throw new BaseAppError(
          'SERVICE_INITIALIZATION_FAILED',
          `Failed to initialize service '${serviceName}'`,
          { context: { serviceName, error: error instanceof Error ? error.message : String(error) } }
        );
      }
    }
  }

  /**
   * Perform health checks on all services
   */
  async healthCheck(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const serviceName of this.initializationOrder) {
      try {
        const instance = this.singletonInstances.get(serviceName);
        
        if (this.isManagedService(instance)) {
          const isHealthy = await instance.onHealthCheck?.() ?? true;
          results.set(serviceName, isHealthy);
        } else {
          results.set(serviceName, true);
        }
      } catch (error: unknown) {
        results.set(serviceName, false);
      }
    }

    return results;
  }

  /**
   * Shutdown the container and cleanup resources
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Shutdown services in reverse initialization order
    const shutdownOrder = [...this.initializationOrder].reverse();

    for (const serviceName of shutdownOrder) {
      try {
        const instance = this.singletonInstances.get(serviceName);
        
        if (this.isManagedService(instance)) {
          await instance.onDestroy?.();
        }
      } catch (error: unknown) {
        if (typeof console !== 'undefined' && console.error) {
          console.error(`Error shutting down service '${serviceName}':`, error);
        }
      }
    }

    // Clear all instances
    this.singletonInstances.clear();
    this.scopedInstances.clear();
    this.initializationOrder = [];
  }

  /**
   * Clear scoped instances (useful for request-scoped services)
   */
  clearScope(): void {
    this.scopedInstances.clear();
  }

  /**
   * Get service registration info
   */
  getServiceInfo(name: string): ServiceRegistration | undefined {
    return this.services.get(name);
  }

  /**
   * Create service instance based on lifecycle
   */
  private createInstance<T>(name: string, registration: ServiceRegistration<T>): T {
    switch (registration.lifecycle) {
      case 'singleton':
        return this.getSingletonInstance(name, registration);
      
      case 'scoped':
        return this.getScopedInstance(name, registration);
      
      case 'transient':
        return this.createTransientInstance(name, registration);
      
      default:
        throw new BaseAppError(
          'INVALID_LIFECYCLE',
          `Invalid service lifecycle: ${registration.lifecycle}`,
          { context: { serviceName: name, lifecycle: registration.lifecycle } }
        );
    }
  }

  /**
   * Get or create singleton instance
   */
  private getSingletonInstance<T>(name: string, registration: ServiceRegistration<T>): T {
    if (this.singletonInstances.has(name)) {
      return this.singletonInstances.get(name);
    }

    const instance = this.createTransientInstance(name, registration);
    this.singletonInstances.set(name, instance);
    return instance;
  }

  /**
   * Get or create scoped instance
   */
  private getScopedInstance<T>(name: string, registration: ServiceRegistration<T>): T {
    if (this.scopedInstances.has(name)) {
      return this.scopedInstances.get(name);
    }

    const instance = this.createTransientInstance(name, registration);
    this.scopedInstances.set(name, instance);
    return instance;
  }

  /**
   * Create new transient instance
   */
  private createTransientInstance<T>(name: string, registration: ServiceRegistration<T>): T {
    try {
      // Check for circular dependencies
      this.checkCircularDependencies(name, new Set());
      
      return registration.factory(this);
    } catch (error: unknown) {
      throw new BaseAppError(
        'SERVICE_CREATION_FAILED',
        `Failed to create service '${name}'`,
        { context: { serviceName: name, error: error instanceof Error ? error.message : String(error) } }
      );
    }
  }

  /**
   * Check for circular dependencies
   */
  private checkCircularDependencies(serviceName: string, visited: Set<string>): void {
    if (visited.has(serviceName)) {
      throw new BaseAppError(
        'CIRCULAR_DEPENDENCY',
        `Circular dependency detected: ${Array.from(visited).join(' -> ')} -> ${serviceName}`,
        { context: { serviceName, dependencyChain: Array.from(visited) } }
      );
    }

    visited.add(serviceName);

    const registration = this.services.get(serviceName);
    if (registration?.dependencies) {
      for (const dependency of registration.dependencies) {
        this.checkCircularDependencies(dependency, new Set(visited));
      }
    }
  }

  /**
   * Topological sort for dependency resolution order
   */
  private topologicalSort(serviceNames: string[]): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const result: string[] = [];

    const visit = (serviceName: string): void => {
      if (visiting.has(serviceName)) {
        throw new BaseAppError(
          'CIRCULAR_DEPENDENCY',
          `Circular dependency detected involving service '${serviceName}'`,
          { context: { serviceName } }
        );
      }

      if (visited.has(serviceName)) {
        return;
      }

      visiting.add(serviceName);

      const registration = this.services.get(serviceName);
      if (registration?.dependencies) {
        for (const dependency of registration.dependencies) {
          if (serviceNames.includes(dependency)) {
            visit(dependency);
          }
        }
      }

      visiting.delete(serviceName);
      visited.add(serviceName);
      result.push(serviceName);
    };

    for (const serviceName of serviceNames) {
      visit(serviceName);
    }

    return result;
  }

  /**
   * Check if instance implements ManagedService interface
   */
  private isManagedService(instance: any): instance is ManagedService {
    return instance && 
           typeof instance === 'object' && 
           typeof instance.serviceName === 'string';
  }
}