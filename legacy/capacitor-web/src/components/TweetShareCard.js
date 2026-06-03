import React from 'react';

/**
 * Tweet-style card used only for X sharing.
 * Rendered off-screen and converted to an image.
 */
const TweetShareCard = React.forwardRef(function TweetShareCard(props, ref) {
  const {
    displayName = 'Detea User',
    username = 'detea_user',
    text,
    imageUrl,
    profileImageUrl,
    width = 1080,
    height, // optional; if omitted we derive from width using 7:10 aspect ratio
  } = props;

  // Normalize numeric width/height and enforce width : height = 7 : 10 when height is not provided
  const numericWidth = typeof width === 'number' ? width : 1080;
  const numericHeight =
    typeof height === 'number' ? height : Math.round((numericWidth * 10) / 7);

  return (
    <div
      ref={ref}
      style={{
        width: numericWidth,
        minHeight: numericHeight,
        height: 'auto',
        borderRadius: 24,
        border: '1px solid #E5E7EB',
        backgroundColor: '#FFFFFF',
        padding: 20,
        boxSizing: 'border-box',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              overflow: 'hidden',
              backgroundColor: '#EFF3F4',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
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
                  fontSize: 18,
                  fontWeight: 700,
                  color: '#0F1419',
                }}
              >
                {displayName.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                minWidth: 0,
                fontSize: 18,
                fontWeight: 700,
                color: '#0F1419',
              }}
            >
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayName}
              </span>
              <img
                src={`${process.env.PUBLIC_URL || ''}/DEITECIrc.webp`}
                alt=""
                width={18}
                height={18}
                style={{
                  width: 18,
                  height: 18,
                  flexShrink: 0,
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
            </span>
            <span
              style={{
                marginTop: 2,
                fontSize: 14,
                color: '#536471',
              }}
            >
              @{username}
            </span>
          </div>
        </div>

        {/* Tweet text — no line clamp so full text is visible */}
        <div
          style={{
            fontSize: 16,
            lineHeight: 1.45,
            color: '#0F1419',
            marginTop: 12,
            marginBottom: 16,
            whiteSpace: 'normal',
            wordBreak: 'break-word',
          }}
        >
          {text}
        </div>

        {/* Image */}
        {imageUrl && (
          <div
            style={{
              width: '100%',
              borderRadius: 16,
              overflow: 'hidden',
            }}
          >
            <img
              src={imageUrl}
              alt=""
              style={{
                width: '100%',
                height: 'auto',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          </div>
        )}
    </div>
  );
});

export default TweetShareCard;

