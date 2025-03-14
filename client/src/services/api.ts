import axios from 'axios';

// Add API_URL export at the top of the file
export const API_URL = process.env.REACT_APP_API_URL || 'https://api.abaj.cloud';

// Set up axios instance
const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Add token to requests if it exists
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Authentication services
export const login = async (email: string, password: string) => {
  const response = await api.post('/api/auth/login', { email, password });
  return response.data;
};

export const register = async (username: string, email: string, password: string) => {
  const response = await api.post('/api/auth/register', { username, email, password });
  return response.data;
};

export const getCurrentUser = async () => {
  const response = await api.get('/api/auth/me');
  return response.data;
};

export const checkApiKey = async () => {
  const response = await api.get('/api/auth/apikey');
  return response.data;
};

export const saveApiKey = async (apiKey: string) => {
  const response = await api.post('/api/auth/apikey', { apiKey });
  return response.data;
};

// Book services
export const getBooks = async () => {
  console.log('API Service: Making request to /api/books');
  try {
    const response = await api.get('/api/books');
    console.log('API Service: Successfully received books response:', response);
    return response.data;
  } catch (error) {
    console.error('API Service: Error fetching books:', error);
    throw error;
  }
};

export const getBook = async (id: number) => {
  const response = await api.get(`/api/books/${id}`);
  return response.data;
};

// Chat services
export const sendChatMessage = async (bookId: number, message: string, chatHistory: any[] = []) => {
  console.log('Sending chat message to book ID:', bookId);
  console.log('Current auth token:', localStorage.getItem('token')?.substring(0, 20) + '...');
  
  // Ensure the token is in the headers
  const token = localStorage.getItem('token');
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }
  
  try {
    const response = await api.post(`/api/chat/${bookId}`, { message, chatHistory });
    console.log('Chat message response:', response);
    return response.data;
  } catch (error) {
    console.error('Error in sendChatMessage:', error);
    throw error;
  }
};

export const getChatHistory = async (bookId: number) => {
  const response = await api.get(`/api/chat/${bookId}`);
  return response.data;
};

export const clearChatHistory = async (bookId: number) => {
  const response = await api.delete(`/api/chat/${bookId}`);
  return response.data;
};

// New function to track embedding progress
export const trackEmbeddingProgress = (
  bookId: number,
  onProgress: (
    processedChunks: number, 
    totalChunks: number, 
    exactWordCount?: number, 
    exactTokenCount?: number
  ) => void,
  onError: (error: Error) => void,
  onComplete?: () => void
): (() => void) => {
  // Get token for authorization
  const token = localStorage.getItem('token');
  if (!token) {
    onError(new Error('Authentication token not found'));
    return () => {}; // Return empty cleanup function
  }
  
  console.log(`Setting up EventSource for book ID: ${bookId}`);
  
  // Create EventSource for SSE connection
  const eventSourceUrl = `${API_URL}/api/chat/progress/${bookId}?token=${encodeURIComponent(token)}`;
  console.log(`EventSource URL: ${eventSourceUrl}`);
  
  // Try creating the EventSource
  let eventSource: EventSource;
  
  // Add missing variables
  let lastProcessed = 0;
  let lastTotal = 0;
  let lastWordCount = 0;
  let lastTokenCount = 0;
  
  try {
    // Create with withCredentials set to true
    eventSource = new EventSource(eventSourceUrl, { withCredentials: true });
    
    // Add more debug logging
    console.log('EventSource created successfully');
    
    // Flag to track if we've received at least one valid progress update
    let receivedValidProgress = false;
    // Flag to track if we're expecting the connection to close
    let expectingClose = false;
    
    // Set up event handlers
    eventSource.onopen = () => {
      console.log('SSE Connection opened successfully');
      // Reset error state if we successfully open a connection
      receivedValidProgress = false;
    };
    
    eventSource.onmessage = (event) => {
      try {
        console.log('Progress update received:', event.data);
        
        // Parse the progress data
        const data = JSON.parse(event.data);
        
        // Check if the progress data is valid
        if (typeof data === 'object' && 'processedChunks' in data && 'totalChunks' in data) {
          console.log(`Progress: ${data.processedChunks}/${data.totalChunks}`);
          
          // Store the last values for potential reconnection
          lastProcessed = data.processedChunks;
          lastTotal = data.totalChunks;
          lastWordCount = data.exactWordCount || 0;
          lastTokenCount = data.exactTokenCount || 0;
          
          // Set receivedValidProgress to true when we get actual progress data
          if (data.totalChunks > 0) {
            receivedValidProgress = true;
          }
          
          // Call the onProgress callback with the current progress
          onProgress(
            data.processedChunks, 
            data.totalChunks, 
            data.exactWordCount || 0, 
            data.exactTokenCount || 0
          );
          
          // If processing is complete, close the connection cleanly
          if (data.processedChunks === data.totalChunks && data.totalChunks > 0) {
            console.log('Processing complete - closing SSE connection');
            expectingClose = true;
            
            // Store the final values for any error handling later
            lastProcessed = data.processedChunks;
            lastTotal = data.totalChunks;
            lastWordCount = data.exactWordCount || 0;
            lastTokenCount = data.exactTokenCount || 0;
            
            // Call onProgress one more time with the final values to ensure they're captured
            onProgress(
              data.processedChunks,
              data.totalChunks,
              data.exactWordCount || 0,
              data.exactTokenCount || 0
            );
            
            // Give UI time to show 100% completion before closing
            setTimeout(() => {
              eventSource.close();
              
              // Call onComplete if provided
              if (onComplete) {
                onComplete();
              }
            }, 1000);
          }
        } else {
          console.warn('Received malformed progress data:', data);
        }
      } catch (error) {
        console.error('Error parsing progress data:', error);
      }
    };
    
    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      
      // If we're getting a CORS error, try without credentials
      if (!receivedValidProgress && !expectingClose) {
        console.log('Attempting to reconnect without credentials');
        eventSource.close();
        
        try {
          // Create a fallback request to get progress directly
          fetch(`${API_URL}/api/chat/progress/${bookId}`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          })
          .then(response => response.json())
          .then(data => {
            console.log('Fallback progress data:', data);
            // Update last values
            lastProcessed = data.processedChunks;
            lastTotal = data.totalChunks;
            lastWordCount = data.exactWordCount || 0;
            lastTokenCount = data.exactTokenCount || 0;
            
            // Call the progress callback with updated values
            onProgress(
              data.processedChunks, 
              data.totalChunks, 
              data.exactWordCount || 0, 
              data.exactTokenCount || 0
            );
            
            // If processing is complete, finalize
            if (data.processedChunks === data.totalChunks && data.totalChunks > 0) {
              console.log('Fallback request: Processing complete');
              // Call onComplete if provided
              if (onComplete) {
                onComplete();
              }
            }
          })
          .catch(err => console.error('Fallback request failed:', err));
        } catch (fallbackError) {
          console.error('Error making fallback request:', fallbackError);
        }
      }
      
      // If we've already received valid progress, don't report errors
      if (receivedValidProgress) {
        console.log('SSE connection error after receiving valid progress - ignoring');
        
        // If we're near the end (>90% done), assume it completed successfully
        if (lastProcessed > 0 && lastTotal > 0 && (lastProcessed / lastTotal) > 0.9) {
          console.log('Almost complete, closing connection silently');
          expectingClose = true;
          eventSource.close();
          
          // Send one final progress update to show 100% completion
          onProgress(lastTotal, lastTotal, lastWordCount, lastTokenCount);
          return;
        }
      }
      
      // Don't report errors if we're expecting to close
      if (!expectingClose && !receivedValidProgress) {
        onError(new Error('Error connecting to progress updates'));
      }
      
      // Always close the connection on error to prevent duplicate connections
      try {
        eventSource.close();
      } catch (e) {
        console.error('Error closing EventSource:', e);
      }
    };
    
    // Return a cleanup function
    return () => {
      console.log('Cleaning up SSE connection');
      expectingClose = true; // Mark as expecting close to prevent error messages
      try {
        eventSource.close();
      } catch (e) {
        console.error('Error during cleanup of EventSource:', e);
      }
    };
    
  } catch (err) {
    console.error("Failed to create EventSource:", err);
    onError(new Error('Failed to initialize progress tracking'));
    
    // Try a fallback polling approach
    console.log('Falling back to polling for progress updates');
    
    // Set up a polling interval as fallback
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${API_URL}/api/chat/progress/${bookId}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log('Poll progress data:', data);
          
          if (data && typeof data.processedChunks === 'number' && typeof data.totalChunks === 'number') {
            // Store the last values for potential error handling
            lastProcessed = data.processedChunks;
            lastTotal = data.totalChunks;
            lastWordCount = data.exactWordCount || 0;
            lastTokenCount = data.exactTokenCount || 0;
            
            // Call the progress callback with the updated values
            onProgress(
              data.processedChunks, 
              data.totalChunks,
              data.exactWordCount || 0,
              data.exactTokenCount || 0
            );
            
            // If processing is complete, clean up
            if (data.processedChunks === data.totalChunks && data.totalChunks > 0) {
              console.log('Polling: Processing complete. Cleaning up polling interval');
              clearInterval(pollInterval);
              
              // Send one final clean progress update
              onProgress(
                data.totalChunks,  // Ensure 100% is shown
                data.totalChunks,
                data.exactWordCount || lastWordCount || 0,
                data.exactTokenCount || lastTokenCount || 0
              );
              
              // Call onComplete if provided
              if (onComplete) {
                onComplete();
              }
            }
          }
        }
      } catch (error) {
        console.error('Error polling for progress:', error);
      }
    }, 3000); // Poll every 3 seconds
    
    // Return a cleanup function for the polling
    return () => {
      console.log('Cleaning up progress polling');
      clearInterval(pollInterval);
    };
  }
};

export default api; 