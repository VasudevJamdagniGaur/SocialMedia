import React, { useState, useEffect } from 'react';
import Shuffle from './Shuffle';

const ShuffleText = () => {
  const words = ['Feel', 'Reflect', 'Heal', 'Detea'];
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prevIndex) => (prevIndex + 1) % words.length);
    }, 2500); // Change word every 2.5 seconds

    return () => clearInterval(interval);
  }, []);

  return (
    <Shuffle
      text={words[currentIndex]}
      className="shuffle-text"
      style={{
        background: 'linear-gradient(135deg, #8BC34A 0%, #A5D6A7 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        fontSize: 'inherit',
        fontWeight: 'inherit',
      }}
      duration={0.6}
      scrambleCharset="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
      tag="span"
    />
  );
};

export default ShuffleText;
