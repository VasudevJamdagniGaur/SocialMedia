import React, { useEffect, useState, useRef } from 'react';

const Shuffle = ({
  text,
  className = '',
  style = {},
  duration = 0.5,
  scrambleCharset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  tag = 'span',
}) => {
  const [displayText, setDisplayText] = useState('');
  const [isAnimating, setIsAnimating] = useState(false);
  const previousText = useRef(text);

  useEffect(() => {
    if (previousText.current === text) {
      setDisplayText(text);
      return;
    }

    setIsAnimating(true);
    previousText.current = text;

    const chars = text.split('');
    const maxLength = Math.max(chars.length, displayText.length);
    const iterations = 10;
    let currentIteration = 0;

    const interval = setInterval(() => {
      if (currentIteration >= iterations) {
        setDisplayText(text);
        setIsAnimating(false);
        clearInterval(interval);
        return;
      }

      const shuffled = chars.map((char, index) => {
        const progress = currentIteration / iterations;
        const charProgress = Math.min(1, Math.max(0, (progress * chars.length - index) / 2));
        
        if (charProgress >= 1) {
          return char;
        }
        
        if (char === ' ') return ' ';
        
        return scrambleCharset[Math.floor(Math.random() * scrambleCharset.length)];
      }).join('');

      setDisplayText(shuffled.padEnd(maxLength, ' ').slice(0, maxLength));
      currentIteration++;
    }, duration * 1000 / iterations);

    return () => clearInterval(interval);
  }, [text, duration, scrambleCharset]);

  const Tag = tag || 'span';
  const classes = `shuffle-parent ${isAnimating ? 'is-animating' : ''} ${className}`;

  return React.createElement(Tag, {
    className: classes,
    style: {
      ...style,
      display: 'inline-block',
      minWidth: '1em',
    }
  }, displayText || text);
};

export default Shuffle;
