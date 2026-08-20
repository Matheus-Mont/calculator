interface ErrorBannerProps {
  message: string | null;
  onDismiss: () => void;
}

/**
 * Surfaces a failed calculation.
 *
 * role="alert" so the message is announced immediately: an error is the one
 * thing a user must not miss after pressing "=".
 */
export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  if (message === null) return null;

  return (
    <div className="error-banner" role="alert">
      <span className="error-banner__icon" aria-hidden="true">
        !
      </span>
      <p className="error-banner__message">{message}</p>
      <button type="button" className="error-banner__dismiss" onClick={onDismiss} aria-label="Dismiss error">
        ×
      </button>
    </div>
  );
}
