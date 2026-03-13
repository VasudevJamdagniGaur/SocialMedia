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
  } = props;

  return (
    <div
      ref={ref}
      style={{
        width: 1080,
        backgroundColor: '#000000',
        color: '#E7E9EA',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        padding: 32,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          maxWidth: 900,
          margin: '0 auto',
          borderRadius: 32,
          border: '1px solid #2F3336',
          backgroundColor: '#000000',
          padding: 32,
          boxSizing: 'border-box',
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
                'linear-gradient(135deg, rgba(168,85,247,0.4), rgba(56,189,248,0.4))',
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
                color: '#E7E9EA',
                lineHeight: 1.2,
              }}
            >
              {displayName}
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 24,
                color: '#8B98A5',
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
            color: '#E7E9EA',
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
              border: '1px solid #2F3336',
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
          }}
        >
          <span
            style={{
              fontSize: 20,
              color: '#8B98A5',
            }}
          >
            Created with DeTea
          </span>
        </div>
      </div>
    </div>
  );
});

export default TweetShareCard;

