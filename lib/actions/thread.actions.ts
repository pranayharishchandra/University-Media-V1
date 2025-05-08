"use server";

import { revalidatePath } from "next/cache";

import { connectToDB } from "../mongoose";

import User from "../models/user.model";
import Thread from "../models/thread.model";
import Community from "../models/community.model";

export async function fetchPosts(pageNumber = 1, pageSize = 20) {
  connectToDB();

  // Calculate the number of posts to skip based on the page number and page size.
  const skipAmount = (pageNumber - 1) * pageSize;

  // Create a query to fetch the posts that have no parent (top-level threads) (a thread that is not a comment/reply).
  const postsQuery = Thread.find({ parentId: { $in: [null, undefined] } })
    .sort({ createdAt: "desc" })
    .skip(skipAmount)
    .limit(pageSize)
    .populate({
      path: "author",
      model: User,
    })
    .populate({
      path: "community",
      model: Community,
    })
    .populate({
      path: "children", // Populate the children field
      populate: {
        path: "author", // Populate the author field within children
        model: User,
        select: "_id name designation parentId image", // Select only _id and username fields of the author
      },
    });
/*
* Yes, in Mongoose's populate method, if you don't specify the select option, it will populate all fields of the referenced document by default. So, in your code snippet, when you populate the "author" field with the User model without specifying select, it will fetch and populate all fields of the User document associated with that author.
 */

  // Count the total number of top-level posts (threads) i.e., threads that are not comments.
  const totalPostsCount = await Thread.countDocuments({
    parentId: { $in: [null, undefined] },
  }); // Get the total count of posts

  const posts = await postsQuery.exec();

  const isNext = totalPostsCount > skipAmount + posts.length;

  return { posts, isNext };
}

interface Params {
  text: string,
  author: string,
  communityId: string | null,
  path: string,
  image?: string,
}

//* author: userId

export async function createThread({ text, image, author, communityId, path }: Params) {
  try {
    connectToDB();

    const communityIdObject = await Community.findOne(
      { id: communityId },
      { _id: 1 }
    );

    const createdThread = await Thread.create({
      text,
      image,
      author,                       //* author: userId, 
                                    //* joining tables | Thread to User | FK PK - userId 
                                    //* we just need to give objectId, and this will act as foreign key for Thread's "author" to refer the User table of which userId is a primary key
      community: communityIdObject, // Assign communityId if provided, or leave it null for personal account
    });

    //* Also update User model - that this user have done this post
    await User.findByIdAndUpdate(author, {
      $push: { threads: createdThread._id },
    });

    if (communityIdObject) {
      // Update Community model
      await Community.findByIdAndUpdate(communityIdObject, {
        $push: { threads: createdThread._id },
      });
    }

    revalidatePath(path);
  } catch (error: any) {
    throw new Error(`Failed to create post: ${error.message}`);
  }
}

async function fetchAllChildThreads(threadId: string): Promise<any[]> {
  const childThreads = await Thread.find({ parentId: threadId });

  const descendantThreads = [];
  for (const childThread of childThreads) {
    const descendants = await fetchAllChildThreads(childThread._id);
    descendantThreads.push(childThread, ...descendants);
  }

  return descendantThreads;
}

export async function deleteThread(id: string, path: string): Promise<void> {
  try {
    connectToDB();

    // Find the thread to be deleted (the main thread)
    const mainThread = await Thread.findById(id).populate("author community");

    if (!mainThread) {
      throw new Error("Thread not found");
    }

    // Fetch all child threads and their descendants recursively
    const descendantThreads = await fetchAllChildThreads(id);

    // Get all descendant thread IDs including the main thread ID and child thread IDs
    const descendantThreadIds = [
    id,
      ...descendantThreads.map((thread) => thread._id),
    ];

    // Extract the authorIds and communityIds to update User and Community models respectively
    const uniqueAuthorIds = new Set(
      [
        ...descendantThreads.map((thread) => thread.author?._id?.toString()), // Use optional chaining to handle possible undefined values
        mainThread.author?._id?.toString(),
      ].filter((id) => id !== undefined)
    );

    const uniqueCommunityIds = new Set(
      [
        ...descendantThreads.map((thread) => thread.community?._id?.toString()), // Use optional chaining to handle possible undefined values
        mainThread.community?._id?.toString(),
      ].filter((id) => id !== undefined)
    );

    // Recursively delete child threads and their descendants
    await Thread.deleteMany({ _id: { $in: descendantThreadIds } });

    // Update User model
    await User.updateMany(
      { _id: { $in: Array.from(uniqueAuthorIds) } },
      { $pull: { threads: { $in: descendantThreadIds } } }
    );

    // Update Community model
    await Community.updateMany(
      { _id: { $in: Array.from(uniqueCommunityIds) } },
      { $pull: { threads: { $in: descendantThreadIds } } }
    );

    revalidatePath(path);
  } catch (error: any) {
    throw new Error(`Failed to delete thread: ${error.message}`);
  }
}

export async function fetchThreadById(threadId: string) {
  connectToDB();

  try {
    const thread = await Thread.findById(threadId)
      .populate({
        path  : "author",              
        model : User,
        select: "_id id name designation image",   


      })                               
      .populate({
        path  : "community",
        model : Community,
        select: "_id id name designation image",
      }) // Populate the community field with _id and name

      //* populating for comments(childre) under a post(parent)
      .populate({ //* now this is kind of recursion, in which we are populating the field "children" of model:Thread but we are also populating the array of object what we are populating
        path    : "children",                       // Populate the children field or comments of the current(parent) Thread/post
        populate: [      

          {
            path  : "author",                       // Populate the author field within children
            model : User,
            select: "_id id name designation parentId image",   // Select only _id and username fields of the author
          },

          //* "we are populating children by children" | "children means comments" | "here we are doing comments under comments" | :i.e. RECURSION
          {
            path    : "children",   // Populate the children field within children
            model   : Thread,       // The model of the nested children (assuming it's the same "Thread" model)

            populate: {
                  path  : "author",                       // Populate the author field within nested children
                  model : User,
                  select: "_id id name designation parentId image",   // Select only _id and username fields of the author
            },
          },
        ],
      })
      .exec();

    return thread;
  } catch (err) {
    console.error("Error while fetching thread:", err);
    throw new Error("Unable to fetch thread");
  }
}

/* select: "_id id name parentId image", parentId is field of referenced model "Thread" and not referening model "User"

question : 
in select we can not only write the fields of the referenced model but also the fields of referencing model right, like here we are referencing parentId which is not the field of refrenced model but field of referencing model 

answer:
*Yes, you are correct. In Mongoose's populate method, the select option allows you to specify fields not only from the referenced model but also from the referencing model.
So, in the context of your code snippet, when you include parentId in the select option for the User model in the populate method of the Thread model, you are able to populate the "author" field in the children threads with the specified fields from both the User model and the Thread model.
This flexibility allows you to customize the data that gets populated into the current document based on fields from both the referenced and referencing models, providing a more versatile way to shape the populated data according to your requirements.
*/

export async function addCommentToThread(
  threadId: string,
  commentText: string,
  userId: string,
  path: string
) {
  connectToDB();

  try {
    // Find the original thread by its ID
    const originalThread = await Thread.findById(threadId);

    if (!originalThread) {
      throw new Error("Thread not found");
    }

    // Create the new comment thread
    const commentThread = new Thread({
      text: commentText,
      author: userId,
      parentId: threadId, // Set the parentId to the original thread's ID
    });

    // Save the comment thread to the database
    const savedCommentThread = await commentThread.save();

    // Add the comment thread's ID to the original thread's children array
    originalThread.children.push(savedCommentThread._id);

    // Save the updated original thread to the database
    await originalThread.save();

    revalidatePath(path);
  } catch (err) {
    console.error("Error while adding comment:", err);
    throw new Error("Unable to add comment");
  }
}


/*
* write model:"...." only when you need to select some fields from it to populate

Yes, you are correct. In Mongoose's populate method, the model option is used to specify the referenced model, and the select option is used to select specific fields from the referenced model. So, when you specify the model as User and include select with specific fields, you are selecting only those fields from the referenced User model.

Yes, in Mongoose's populate method, the select option allows you to specify fields not only from the referenced model but also from the referencing model. This flexibility allows you to customize the data that gets populated into the current document based on fields from both the referenced and referencing models, providing a more versatile way to shape the populated data according to your requirements.
*/