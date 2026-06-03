import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Error Boundary Component to catch initialization errors
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('❌ App Error:', error);
    console.error('❌ Error Info:', errorInfo);
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          background: '#090A0F',
          color: '#fff',
          fontFamily: 'system-ui, sans-serif'
        }}>
          <h1 style={{ fontSize: '24px', marginBottom: '20px', color: '#8BC34A' }}>
            Something went wrong
          </h1>
          <div style={{
            background: 'rgba(255, 255, 255, 0.1)',
            padding: '20px',
            borderRadius: '8px',
            maxWidth: '600px',
            marginBottom: '20px'
          }}>
            <p style={{ marginBottom: '10px' }}>
              {this.state.error && this.state.error.toString()}
            </p>
            {this.state.errorInfo && (
              <details style={{ marginTop: '10px' }}>
                <summary style={{ cursor: 'pointer', marginBottom: '10px' }}>
                  Error Details
                </summary>
                <pre style={{
                  background: 'rgba(0, 0, 0, 0.3)',
                  padding: '10px',
                  borderRadius: '4px',
                  overflow: 'auto',
                  fontSize: '12px'
                }}>
                  {this.state.errorInfo.componentStack || 'No component stack available'}
                </pre>
              </details>
            )}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 20px',
              background: '#8BC34A',
              color: '#000',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

