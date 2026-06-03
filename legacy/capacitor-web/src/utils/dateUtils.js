/**
 * Generate date ID in India timezone (Asia/Kolkata)
 * Returns format: "2025-08-29"
 */
export const getDateId = (date = new Date()) => {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
};

/**
 * Get current date in India timezone as Date object
 */
export const getIndiaDate = () => {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const istOffset = 5.5; // IST is UTC+5:30
  return new Date(utc + (istOffset * 3600000));
};

/**
 * Format date for display
 * @param {string|Date} dateInput - Date ID string (YYYY-MM-DD) or Date object
 * @returns {string} Formatted date string
 */
export const formatDateForDisplay = (dateInput) => {
  let date;
  if (dateInput instanceof Date) {
    date = dateInput;
  } else {
    // dateInput is a dateId string (YYYY-MM-DD)
    date = new Date(dateInput + 'T00:00:00'); // Add time to avoid timezone issues
  }
  return date.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
};

/**
 * Check if a date is today (in India timezone)
 */
export const isToday = (dateId) => {
  return dateId === getDateId();
};

/**
 * Get date ID for a specific number of days ago
 */
export const getDateIdDaysAgo = (daysAgo) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return getDateId(date);
};

/**
 * Get reflection from localStorage (with fallback to backup)
 * @param {string} dateId - Date ID in format "YYYY-MM-DD"
 * @returns {string} Reflection text or empty string
 */
export const getReflectionFromLocalStorage = (dateId) => {
  const storedReflection = localStorage.getItem(`reflection_${dateId}`);
  const backupReflection = localStorage.getItem(`reflection_backup_${dateId}`);
  return storedReflection || backupReflection || '';
};