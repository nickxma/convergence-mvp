'use client';

import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback: ReactNode | ((retry: () => void) => ReactNode);
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(_error: Error): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  retry = () => this.setState({ hasError: false });

  render() {
    if (this.state.hasError) {
      const { fallback } = this.props;
      return typeof fallback === 'function' ? fallback(this.retry) : fallback;
    }
    return this.props.children;
  }
}
