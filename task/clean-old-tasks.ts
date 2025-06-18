import { supabase } from '../supabase/client';
import fs from 'fs';
import path from 'path';

async function cleanOldTasks(ownerId: string) {
  try {
    // Get all tasks from db with this owner
    const { data: tasks, error: fetchError } = await supabase
      .from('tasks')
      .select('id, created_at, file_path')
      .eq('owner_id', ownerId);

    if (fetchError) throw fetchError;

    // Generate a list of tasks that are older than 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const oldTasks = tasks.filter(task => 
      new Date(task.created_at) < thirtyDaysAgo
    );

    // Delete the tasks from the db
    const { data: deletedTasks, error: deleteError } = await supabase
      .from('tasks')
      .delete()
      .in('id', oldTasks.map(task => task.id));

    if (deleteError) throw deleteError;

    // Delete the tasks from the file system
    for (const task of oldTasks) {
      if (task.file_path) {
        try {
          fs.unlinkSync(path.resolve(task.file_path));
        } catch (error) {
          console.error(`Failed to delete file ${task.file_path}:`, error);
        }
      }
    }

    console.log(`Cleaned up ${oldTasks.length} old tasks`);
    return oldTasks.length;
  } catch (error) {
    console.error('Error cleaning old tasks:', error);
    throw error;
  }
}

// Example usage:
// cleanOldTasks('owner-123');
