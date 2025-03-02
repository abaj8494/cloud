import express, { Router } from 'express';
import { Request, Response, RequestHandler } from 'express';
import { auth } from '../middleware/auth';
import { getBookById } from '../models/Book';
import { saveChatMessage, getChatHistoryByUserAndBook, deleteChatHistory } from '../models/Chat';
import { generateChatResponse, ChatHistoryMessage } from '../utils/openai';
import { 
  embeddingsProgressEmitter, 
  getEmbeddingsProgress 
} from '../utils/embeddings';

const router: Router = express.Router();

// @route   GET api/chat/progress/:bookId
// @desc    Stream embedding progress updates for a book
// @access  Private
router.get('/progress/:bookId', auth, (req: Request, res: Response) => {
  const bookId = parseInt(req.params.bookId);
  
  if (!req.user || !req.user.id) {
    res.status(401).json({ msg: 'User not authenticated' });
    return;
  }
  
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send initial progress if available
  const initialProgress = getEmbeddingsProgress(bookId);
  if (initialProgress) {
    res.write(`data: ${JSON.stringify(initialProgress)}\n\n`);
  } else {
    res.write(`data: ${JSON.stringify({ processedChunks: 0, totalChunks: 0 })}\n\n`);
  }
  
  // Function to handle progress updates
  const progressHandler = (data: { bookId: number; processedChunks: number; totalChunks: number }) => {
    if (data.bookId === bookId) {
      res.write(`data: ${JSON.stringify({
        processedChunks: data.processedChunks,
        totalChunks: data.totalChunks
      })}\n\n`);
    }
  };
  
  // Register event listener
  embeddingsProgressEmitter.on('progress', progressHandler);
  
  // Handle client disconnect
  req.on('close', () => {
    embeddingsProgressEmitter.off('progress', progressHandler);
    res.end();
  });
});

// @route   POST api/chat/:bookId
// @desc    Send a message to chat with a book
// @access  Private
router.post('/:bookId', auth, async (req: Request, res: Response) => {
  try {
    const { message, chatHistory: clientChatHistory } = req.body;
    const bookId = parseInt(req.params.bookId);
    
    if (!req.user || !req.user.id) {
      res.status(401).json({ msg: 'User not authenticated' });
      return;
    }
    
    const userId = req.user.id;
    
    // Get book content
    const book = await getBookById(bookId);
    if (!book) {
      res.status(404).json({ msg: 'Book not found' });
      return;
    }
    
    // Get previous chat history for context
    const previousChats = await getChatHistoryByUserAndBook(userId, bookId);
    
    // Convert to the format expected by generateChatResponse
    const chatHistory: ChatHistoryMessage[] = previousChats.map(chat => ({
      message: chat.message,
      response: chat.response
    }));
    
    // Generate response using OpenAI with chat history and pass bookId for caching
    const response = await generateChatResponse(message, book.content, userId, chatHistory, bookId);
    
    // Save chat message to database
    const chatMessage = await saveChatMessage({
      user_id: userId,
      book_id: bookId,
      message,
      response
    });
    
    res.json(chatMessage);
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ msg: 'Failed to generate response' });
  }
});

// @route   GET api/chat/:bookId
// @desc    Get chat history for a book
// @access  Private
router.get('/:bookId', auth, async (req: Request, res: Response) => {
  try {
    const bookId = parseInt(req.params.bookId);
    
    if (!req.user || !req.user.id) {
      res.status(401).json({ msg: 'User not authenticated' });
      return;
    }
    
    const userId = req.user.id;
    
    // Check if book exists
    const book = await getBookById(bookId);
    if (!book) {
      res.status(404).json({ msg: 'Book not found' });
      return;
    }
    
    // Get chat history
    const chatHistory = await getChatHistoryByUserAndBook(userId, bookId);
    
    res.json(chatHistory);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// @route   DELETE api/chat/:bookId
// @desc    Delete chat history for a book
// @access  Private
router.delete('/:bookId', auth, async (req: Request, res: Response) => {
  try {
    const bookId = parseInt(req.params.bookId);
    
    if (!req.user || !req.user.id) {
      res.status(401).json({ msg: 'User not authenticated' });
      return;
    }
    
    const userId = req.user.id;
    
    // Delete chat history
    const deletedCount = await deleteChatHistory(userId, bookId);
    
    res.json({ msg: 'Chat history deleted', count: deletedCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

export default router; 