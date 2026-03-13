import React from 'react';

/**
 * Tweet-style card used only for X sharing.
 * Rendered off-screen and converted to an image.
 */
const TweetShareCard = React.forwardRef(function TweetShareCard(props, ref) {
  const {
    displayName = 'DeTea User',
    username = 'detea_user',
    text,
    imageUrl,
    profileImageUrl,
    width = 1080,
    height, // optional; when provided we force this height
  } = props;

  return (
    <div
      ref={ref}
      style={{
        width,
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius: 40,
        border: '1px solid #D1D5DB',
        backgroundColor: '#FFFFFF',
        padding: 36,
        boxSizing: 'border-box',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              overflow: 'hidden',
              marginRight: 20,
              background:
                'linear-gradient(135deg, rgba(37,99,235,0.4), rgba(79,70,229,0.5))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {profileImageUrl ? (
              <img
                src={profileImageUrl}
                alt={displayName}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  color: '#FFFFFF',
                }}
              >
                {displayName.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 30,
                fontWeight: 700,
                color: '#0F1419',
                lineHeight: 1.2,
              }}
            >
              {displayName}
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 24,
                color: '#536471',
              }}
            >
              @{username}
            </div>
          </div>
        </div>

        {/* Tweet text */}
        <div
          style={{
            fontSize: 28,
            lineHeight: 1.5,
            color: '#0F1419',
            whiteSpace: 'pre-wrap',
          }}
        >
          {text}
        </div>

        {/* Image */}
        {imageUrl && (
          <div
            style={{
              marginTop: 24,
              borderRadius: 24,
              overflow: 'hidden',
              border: '1px solid #D1D5DB',
            }}
          >
            <img
              src={imageUrl}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        )}

        {/* Watermark */}
        <div
          style={{
            marginTop: 28,
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontSize: 20,
              color: '#6B7280',
            }}
          >
            Created with DeTea
          </span>
        </div>
    </div>
  );
});

export default TweetShareCard;

