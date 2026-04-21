import { Component, ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info });
    console.error('[ErrorBoundary]', error, info);
  }

  reset = () => this.setState({ error: null, info: null });

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            padding: 20,
            background: '#1a1b2e',
            color: '#f87171',
            fontFamily: 'monospace',
            fontSize: 13,
            overflow: 'auto',
            zIndex: 99999,
          }}
        >
          <h2 style={{ color: '#fca5a5', marginTop: 0 }}>Render error caught</h2>
          <div style={{ marginBottom: 12, color: '#fbbf24' }}>
            {this.state.error.name}: {this.state.error.message}
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#d1d5db' }}>
            {this.state.error.stack}
          </pre>
          {this.state.info?.componentStack && (
            <>
              <h3 style={{ color: '#fca5a5' }}>Component stack</h3>
              <pre style={{ whiteSpace: 'pre-wrap', color: '#d1d5db' }}>
                {this.state.info.componentStack}
              </pre>
            </>
          )}
          <button
            onClick={this.reset}
            style={{
              marginTop: 12,
              padding: '8px 16px',
              background: '#0d9488',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Try to recover
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
